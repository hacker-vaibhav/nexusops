const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const PROXY_TARGET = (import.meta.env.VITE_PROXY_TARGET || '').replace(/\/$/, '')

function toWsUrl(base) {
  if (!base) return null
  return base
    .replace(/^https:/, 'wss:')
    .replace(/^http:/, 'ws:')
    .replace(/\/$/, '')
}

function deriveWsCandidates() {
  const explicitWs = import.meta.env.VITE_WS_URL
  const explicitApi = import.meta.env.VITE_API_URL
  const proxyTarget = PROXY_TARGET

  if (explicitWs) return [explicitWs.replace(/\/$/, '')]
  if (explicitApi) return [toWsUrl(explicitApi)]
  if (proxyTarget) return [toWsUrl(proxyTarget)]
  return [window.location.origin.replace(/^http/, 'ws')]
}

// ── API key management ─────────────────────────────────────────────────────
// Stored in memory (per-session). Set via Settings page or VITE_API_KEY env.
let _apiKey = import.meta.env.VITE_API_KEY || localStorage.getItem('nexus_api_key') || 'demo-user'

export function setApiKey(key) {
  _apiKey = key
  localStorage.setItem('nexus_api_key', key)
}

export function getApiKey() { return _apiKey }

export function getApiBase() {
  return API
}

export function getWsBase() {
  return deriveWsCandidates()[0]
}

function authHeaders() {
  return { 'Content-Type': 'application/json', 'X-API-Key': _apiKey }
}

export async function readJsonResponse(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

// ── Tickets ────────────────────────────────────────────────────────────────

export async function submitTicket(ticketText, priority = 3) {
  const res = await fetch(`${API}/api/tickets`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ticket: ticketText, priority }),
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    const detail = data?.detail
    const err = new Error(detail?.reason || detail || data?.raw || `API error ${res.status}`)
    err.detail = detail
    throw err
  }
  return data
}

export async function cancelTicket(taskId) {
  const res = await fetch(`${API}/api/tickets/${taskId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    const detail = data?.detail
    const err = new Error(detail?.reason || detail || data?.raw || `Cancel failed ${res.status}`)
    err.detail = detail
    throw err
  }
  return data
}

export async function validateTicket(ticketText) {
  if (!ticketText || ticketText.trim().length < 3)
    return { status: 'INCOMPLETE', error: 'Too short', suggestion: null }
  try {
    const res = await fetch(
      `${API}/api/health/validate?ticket=${encodeURIComponent(ticketText)}`,
      { headers: authHeaders() }
    )
    return await readJsonResponse(res)
  } catch {
    return { status: 'VALID', confidence: 0.5 }
  }
}

export async function previewCost(ticketText) {
  try {
    const res = await fetch(`${API}/api/tickets/preview-cost`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ ticket: ticketText }),
    })
    if (!res.ok) return null
    return readJsonResponse(res)
  } catch { return null }
}

export async function fetchTask(taskId) {
  const res = await fetch(`${API}/api/tickets/${taskId}`, { headers: authHeaders() })
  if (!res.ok) throw new Error('Task not found')
  return readJsonResponse(res)
}

export async function fetchTasks() {
  const res = await fetch(`${API}/api/tickets`, { headers: authHeaders() })
  if (!res.ok) return []
  return readJsonResponse(res)
}

export async function fetchTrace(taskId) {
  try {
    const res = await fetch(`${API}/api/tickets/${taskId}/trace`, { headers: authHeaders() })
    if (!res.ok) return null
    return readJsonResponse(res)
  } catch { return null }
}

export async function fetchMetrics() {
  try {
    const res = await fetch(`${API}/api/metrics`, { headers: authHeaders() })
    if (!res.ok) return null
    return readJsonResponse(res)
  } catch { return null }
}

export async function fetchHealth() {
  try {
    const res = await fetch(`${API}/api/health`, { headers: authHeaders() })
    if (!res.ok) return false
    const data = await readJsonResponse(res)
    return data?.status === 'ok'
  } catch {
    return false
  }
}

export async function fetchConfig() {
  try {
    const res = await fetch(`${API}/api/config`, { headers: authHeaders() })
    if (!res.ok) return null
    return readJsonResponse(res)
  } catch {
    return null
  }
}

export async function fetchAwsStatus() {
  try {
    const res = await fetch(`${API}/api/aws/status`, { headers: authHeaders() })
    if (!res.ok) return null
    return readJsonResponse(res)
  } catch {
    return null
  }
}

export async function fetchHistory() {
  try {
    const res = await fetch(`${API}/api/history`, { headers: authHeaders() })
    if (!res.ok) return []
    const data = await readJsonResponse(res)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function fetchGenomeRegistry(limit = 12) {
  try {
    const res = await fetch(`${API}/api/genomes/registry?limit=${limit}`, { headers: authHeaders() })
    if (!res.ok) return { items: [], count: 0 }
    return readJsonResponse(res)
  } catch {
    return { items: [], count: 0 }
  }
}

export async function fetchGenomeMatch(ticketText) {
  if (!ticketText || !ticketText.trim()) return null
  try {
    const res = await fetch(`${API}/api/genomes/match?ticket=${encodeURIComponent(ticketText)}`, {
      headers: authHeaders(),
    })
    if (!res.ok) return null
    return readJsonResponse(res)
  } catch {
    return null
  }
}

export async function fetchGenomeById(genomeId) {
  try {
    const res = await fetch(`${API}/api/genomes/registry/${genomeId}`, { headers: authHeaders() })
    if (!res.ok) return null
    return readJsonResponse(res)
  } catch {
    return null
  }
}

// ── WebSocket ──────────────────────────────────────────────────────────────

export function connectToTask(taskId, onMessage, onClose) {
  let ws = null, reconnectTimer = null, stopped = false
  let delay = 1000, reconnects = 0
  const MAX_R = 5
  const candidates = deriveWsCandidates()
  let opened = false

  function connect() {
    if (stopped) return
    const base = candidates[0]
    if (!base || !taskId) return
    // Pass API key as query param (WS doesn't support custom headers in browser)
    ws = new WebSocket(`${base}/ws/${taskId}?key=${encodeURIComponent(_apiKey)}`)
    opened = false
    ws.onopen  = () => {
      opened = true
      delay = 1000
      reconnects = 0
    }
    ws.onmessage = e => { try { onMessage(JSON.parse(e.data)) } catch {} }
    ws.onclose = () => {
      if (stopped) { if (onClose) onClose(); return }
      if (reconnects < MAX_R) {
        reconnects++
        reconnectTimer = setTimeout(connect, Math.max(delay, 1500))
        delay = Math.min(delay * 2, 8000)
      } else { if (onClose) onClose() }
    }
    ws.onerror = () => {
      try { ws.close() } catch {}
    }
  }
  reconnectTimer = setTimeout(connect, 1500)
  return {
    close: () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) ws.close()
    }
  }
}
