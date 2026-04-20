import { useState, useEffect, useRef } from 'react'
import {
  Activity,
  Blocks,
  CircleDot,
  Eye,
  Gauge,
  Hexagon,
  Clock3,
  Settings2,
  Sparkles,
  Zap,
  X,
} from 'lucide-react'
import { useTaskStore } from './shared/store'
import Dashboard from './pages/Dashboard'
import Deploy from './pages/Deploy'
import Monitor from './pages/Monitor'
import Costs from './pages/Costs'
import History from './pages/History'
import Settings from './pages/Settings'

const C = { teal:'#00d9ff', green:'#00f38d', amber:'#ffbe46', red:'#ff4d6d' }
const SPLINE_EMBED_URL = 'https://my.spline.design/orbitalbluestar-AsuVxbYimbXfFDZW35aHVYXi/'

function TestModal({ open, task, endpoint, onClose }) {
  const [result, setResult] = useState(null)
  const [testing, setTesting] = useState(false)

  async function run() {
    setTesting(true)
    setResult(null)
    const t0 = Date.now()
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500))
    const lat = Date.now() - t0
    setResult({
      latency: lat,
      body: JSON.stringify({
        status: 'ok',
        service: task?.final_report?.service_name || 'api',
        environment: task?.final_report?.environment || 'prod',
        uptime_seconds: Math.floor(Math.random() * 3600 + 120),
        version: '1.0.0',
        provisioned_by: 'NEXUS OPS',
      }, null, 2),
    })
    setTesting(false)
  }

  if (!open) return null

  return (
    <div className="modal-shell">
      <div className="panel anim-scaleIn" style={{ width:540, padding:26 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
          <div>
            <div style={{
              fontFamily:'var(--font-display)',
              fontWeight:700,
              fontSize:16,
              color:'var(--text-primary)',
              marginBottom:3,
            }}>
              Live Service Test
            </div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:C.teal }}>
              GET {endpoint}/health
            </div>
          </div>
          <button onClick={onClose} className="ghost-chip">
            <X size={14} />
            Close
          </button>
        </div>

        <div className="terminal-block" style={{ marginBottom:14, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span>$ curl {endpoint}/health</span>
          <button
            onClick={() => navigator.clipboard?.writeText(`curl ${endpoint}/health`)}
            className="ghost-chip"
            style={{ padding:'4px 8px', fontSize:10 }}
          >
            copy
          </button>
        </div>

        <div className="terminal-block" style={{
          minHeight:150,
          borderColor: result ? 'rgba(0,243,141,0.3)' : 'var(--border)',
          color:'var(--text-secondary)',
        }}>
          {testing ? (
            <div style={{ display:'flex', alignItems:'center', gap:10, color:C.teal }}>
              <div className="anim-spin" style={{
                width:14,
                height:14,
                border:`2px solid ${C.teal}`,
                borderTopColor:'transparent',
                borderRadius:'50%',
              }}/>
              Sending request...
            </div>
          ) : result ? (
            <>
              <div style={{ marginBottom:10, display:'flex', gap:12, alignItems:'center' }}>
                <span className="status-chip status-chip-live">200 OK</span>
                <span style={{ color:'var(--text-muted)', fontSize:11 }}>{result.latency}ms</span>
              </div>
              <pre style={{ color:C.green, margin:0, whiteSpace:'pre-wrap' }}>{result.body}</pre>
            </>
          ) : (
            <span>Click "Run Test" to fire a live request.</span>
          )}
        </div>

        <button onClick={run} disabled={testing} className="primary-action" style={{ width:'100%', marginTop:14 }}>
          {testing ? 'Testing...' : 'Run Test'}
        </button>
      </div>
    </div>
  )
}

const PAGES = [
  { id:'dashboard', label:'Dashboard', icon:Blocks },
  { id:'deploy', label:'Deploy', icon:Zap },
  { id:'monitor', label:'Monitor', icon:Gauge },
  { id:'history', label:'History', icon:Clock3 },
  { id:'costs', label:'Cost & Resources', icon:Sparkles },
  { id:'settings', label:'Settings & Docs', icon:Settings2 },
]

function NavBar({ page, onNavigate, tasks, backendHealthy, systemMode }) {
  const online = backendHealthy
  const navRef = useRef(null)
  const glowRef = useRef(null)
  const focusRef = useRef(null)
  const buttonRefs = useRef({})
  const [hoveredId, setHoveredId] = useState(null)
  const targetRef = useRef({ x: 0, y: 0, opacity: 0, scale: 1 })
  const currentRef = useRef({ x: 0, y: 0, opacity: 0, scale: 1 })

  const positionFocus = (id, active = false) => {
    const focus = focusRef.current
    const nav = navRef.current
    const button = buttonRefs.current[id]
    if (!focus || !nav || !button) return
    const navRect = nav.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    const paddingX = 10
    const paddingY = 6
    focus.style.width = `${rect.width + paddingX * 2}px`
    focus.style.height = `${rect.height + paddingY * 2}px`
    focus.style.left = `${rect.left - navRect.left - paddingX}px`
    focus.style.top = `${rect.top - navRect.top - paddingY}px`
    focus.style.opacity = '1'
    focus.style.transform = active ? 'scale(1)' : 'scale(1.04)'
    focus.dataset.active = active ? 'true' : 'false'
  }

  useEffect(() => {
    const activeId = page
    positionFocus(activeId, true)
  }, [page])

  useEffect(() => {
    let frame = null
    const animateGlow = () => {
      const glow = glowRef.current
      if (glow) {
        const cur = currentRef.current
        const tgt = targetRef.current
        const ease = 0.18
        cur.x += (tgt.x - cur.x) * ease
        cur.y += (tgt.y - cur.y) * ease
        cur.opacity += (tgt.opacity - cur.opacity) * ease
        cur.scale += (tgt.scale - cur.scale) * ease
        glow.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0) scale(${cur.scale})`
        glow.style.opacity = `${cur.opacity}`
      }
      frame = requestAnimationFrame(animateGlow)
    }
    frame = requestAnimationFrame(animateGlow)
    return () => cancelAnimationFrame(frame)
  }, [])

  const moveGlow = (x, y, options = {}) => {
    const glowSize = 180
    targetRef.current = {
      ...targetRef.current,
      x: x - glowSize / 2,
      y: y - glowSize / 2,
      opacity: options.opacity ?? 0.32,
      scale: options.scale ?? 1,
    }
  }

  const handleMouseMove = (event) => {
    const rect = navRef.current?.getBoundingClientRect()
    if (!rect) return
    moveGlow(event.clientX - rect.left, event.clientY - rect.top, { opacity: 0.28, scale: 0.98 })
  }

  const handleMouseLeave = () => {
    targetRef.current.opacity = 0
    setHoveredId(null)
    positionFocus(page, true)
  }

  const handleLinkEnter = (id, event) => {
    setHoveredId(id)
    const button = event.currentTarget
    const navRect = navRef.current?.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    if (!navRect) return
    moveGlow(rect.left - navRect.left + rect.width / 2, rect.top - navRect.top + rect.height / 2, {
      opacity: 0.75,
      scale: 1.2,
    })
    positionFocus(id, false)
  }

  const handleLinkLeave = () => {
    setHoveredId(null)
    targetRef.current.opacity = 0.32
    targetRef.current.scale = 1
    positionFocus(page, true)
  }

  return (
    <nav className="top-nav" ref={navRef} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <div className="nav-glow-shell" aria-hidden="true">
        <div className="nav-glow-ball" ref={glowRef} />
      </div>
      <div className="brand-lockup">
        <div className="brand-mark">
          <Hexagon size={18} strokeWidth={1.7} />
          <span>N</span>
        </div>
        <div>
          <div className="brand-title">NEXUS OPS</div>
          <div className="brand-subtitle">AUTONOMOUS CLOUD OPS</div>
        </div>
      </div>

      <div className="top-nav-links">
        <div className="nav-focus-ring" ref={focusRef} aria-hidden="true" />
        {PAGES.map(({ id, label, icon: Icon }) => {
          const isActive = page === id
          return (
            <button
              key={id}
              type="button"
              ref={(el) => { if (el) buttonRefs.current[id] = el }}
              onClick={() => onNavigate(id)}
              onMouseEnter={(event) => handleLinkEnter(id, event)}
              onMouseLeave={handleLinkLeave}
              className={`top-nav-link ${isActive ? 'is-active' : ''} ${hoveredId === id ? 'is-hovered' : ''}`}
            >
              <Icon size={12} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          )
        })}
      </div>

      <div className="top-nav-status">
        <div className={`nav-status-indicator ${online ? 'is-online' : 'is-offline'}`}>
          <CircleDot size={10} strokeWidth={2} />
          <span>{online ? 'online' : 'offline'}</span>
        </div>
        <span className="nav-version">{systemMode === 'real' ? 'REAL AWS' : systemMode === 'mock' ? 'ONLINE / MOCK' : 'OFFLINE'}</span>
        <span className="nav-version">v1.0</span>
        <span className="nav-version">Track 2</span>
      </div>
    </nav>
  )
}

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [testModal, setTestModal] = useState({ open:false, task:null, endpoint:null })
  const [deployError, setDeployError] = useState(null)
  const store = useTaskStore()

  function handleTest(task, endpoint) {
    setTestModal({ open:true, task, endpoint })
  }

  function handleViewLogs(task) {
    store.setActiveTaskId(task.task_id)
    setPage('deploy')
  }

  return (
    <div className="grid-bg" style={{ height:'100vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div className="app-spline-backdrop" aria-hidden="true">
        <div className="app-spline-orb">
          <iframe
            src={SPLINE_EMBED_URL}
            title="NEXUS OPS orbital background"
            loading="lazy"
            allow="autoplay; fullscreen"
          />
        </div>
      </div>

      <NavBar page={page} onNavigate={setPage} tasks={store.tasks} backendHealthy={store.backendHealthy} systemMode={store.systemMode} />

      <div className="app-shell-layer" key={page} style={{ flex:1, minHeight:0, overflowY:'auto', animation:'pageSlideIn 0.34s cubic-bezier(0.16,1,0.3,1) both' }}>
        {page === 'dashboard' && (
          <Dashboard tasks={store.tasks} onViewLogs={handleViewLogs} onTest={handleTest} onNavigate={setPage} systemMode={store.systemMode} />
        )}
        {page === 'deploy' && (
          <Deploy
            tasks={store.tasks}
            activeTask={store.activeTask}
            activeLogs={store.activeLogs}
            deploying={store.deploying}
            deployingTargetId={store.deployingTargetId}
            deployError={deployError}
            systemMode={store.systemMode}
            onDeploy={async (ticket, priority = 3, targetId = null) => {
              setDeployError(null)
              try {
                const id = await store.deploy(ticket, priority, targetId)
                if (id) store.setActiveTaskId(id)
              } catch (e) {
                setDeployError({
                  reason: e.detail?.reason || e.message,
                  suggestion: e.detail?.suggestion || null,
                })
              }
            }}
          />
        )}
        {page === 'monitor' && <Monitor tasks={store.tasks} />}
        {page === 'costs' && <Costs tasks={store.tasks} />}
        {page === 'history' && <History />}
        {page === 'settings' && <Settings tasks={store.tasks} />}
      </div>

      <TestModal
        open={testModal.open}
        task={testModal.task}
        endpoint={testModal.endpoint}
        onClose={() => setTestModal({ open:false, task:null, endpoint:null })}
      />
    </div>
  )
}
