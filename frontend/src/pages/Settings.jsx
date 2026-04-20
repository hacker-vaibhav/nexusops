// pages/Settings.jsx  — Interactive API Explorer + System Info
import { useEffect, useState } from 'react'
import { getCatalogItem, getEndpoint } from '../shared/store'
import { SectionHeader, CopyBtn, Page } from '../components/UI'
import { setApiKey, getApiKey, getApiBase, fetchGenomeRegistry, fetchGenomeMatch, readJsonResponse } from '../utils/api'

const C = { teal:'#00c8e8', green:'#00e676', amber:'#ffab40', red:'#ff5252', purple:'#b388ff' }
const API = getApiBase()

function GenomeRegistryPanel() {
  const [registry, setRegistry] = useState({ items: [], count: 0 })
  const [query, setQuery] = useState('Deploy a production payments-api with S3, EC2 t2.medium, port 8080')
  const [match, setMatch] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchGenomeRegistry(8).then(setRegistry)
  }, [])

  async function runMatch() {
    setLoading(true)
    const next = await fetchGenomeMatch(query)
    setMatch(next)
    setLoading(false)
  }

  const topGenome = registry.items?.[0]
  const featuredGenome = match?.match || topGenome

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, minWidth:0 }}>
      <SectionHeader
        title="INFRAGENOME"
        color={C.purple}
        right={<span style={{ display:'block', maxWidth:'100%', fontSize:10, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase', lineHeight:1.4, textAlign:'right', overflowWrap:'anywhere' }}>
          pattern dna extracted from successful deployments
        </span>}
      />
      <div className="panel" style={{
        padding:'16px 16px 14px',
        border:'1px solid rgba(179,136,255,0.18)',
        boxShadow:'0 18px 48px rgba(3,10,22,0.35), inset 0 1px 0 rgba(255,255,255,0.03)',
        background:'linear-gradient(180deg, rgba(13,24,42,0.95), rgba(8,14,24,0.98))'
      }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:12, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:900, fontSize:13, color:'var(--text-primary)', letterSpacing:'0.04em' }}>
              Living Genome Registry
            </div>
            <div style={{ marginTop:4, fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', lineHeight:1.5, overflowWrap:'anywhere' }}>
              Search proven infra DNA, compare live tickets, and reuse the best-fit pattern.
            </div>
          </div>
          <div style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'7px 10px', borderRadius:999, border:'1px solid rgba(179,136,255,0.26)', background:'rgba(179,136,255,0.08)', color:C.purple, fontFamily:'var(--font-mono)', fontSize:10, whiteSpace:'nowrap', flexShrink:0 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:C.purple, boxShadow:`0 0 10px ${C.purple}` }} />
            {registry.count || 0} genomes
          </div>
        </div>

        <div className="genome-stat-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8, marginBottom:12 }}>
          {[
            ['Registry', `${registry.count || 0}`],
            ['Top match', match?.match?.similarity ? `${Math.round(match.match.similarity * 100)}%` : '—'],
            ['Latest', topGenome?.genome_id || '—'],
          ].map(([label, value], idx) => (
            <div key={label} style={{ position:'relative', overflow:'hidden', padding:'10px 12px', borderRadius:12, background:'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))', border:'1px solid rgba(255,255,255,0.07)', minHeight:54 }}>
              <div style={{ position:'absolute', left:0, top:0, width:2, height:'100%', background: idx === 0 ? C.purple : idx === 1 ? C.teal : C.green, opacity:0.85 }} />
              <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-muted)', letterSpacing:'0.12em', textTransform:'uppercase' }}>
                {label}
              </div>
              <div style={{ fontFamily:'var(--font-display)', fontSize:13, fontWeight:900, color:'var(--text-primary)', marginTop:6, lineHeight:1.1, wordBreak:'break-word' }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding:12, borderRadius:14, border:'1px solid rgba(0,200,232,0.12)', background:'linear-gradient(180deg, rgba(0,200,232,0.04), rgba(255,255,255,0.02))', marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, marginBottom:8, flexWrap:'wrap' }}>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', letterSpacing:'0.1em', textTransform:'uppercase' }}>
              Genome query
            </span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:C.teal }}>
              semantic match search
            </span>
          </div>

          <textarea
            value={query}
            onChange={e => setQuery(e.target.value)}
            rows={4}
            style={{ width:'100%', resize:'vertical', minHeight:92, boxSizing:'border-box', background:'rgba(2,8,16,0.82)', border:'1px solid rgba(0,200,232,0.16)', borderRadius:12, padding:'12px 14px', color:'var(--text-primary)', fontFamily:'var(--font-mono)', fontSize:12, lineHeight:1.6, outline:'none', boxShadow:'inset 0 1px 0 rgba(255,255,255,0.03)' }}
          />

          <div className="genome-query-actions" style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:10, alignItems:'center', marginTop:10 }}>
            <button onClick={runMatch} disabled={loading} style={{ padding:'10px 14px', borderRadius:12, border:'1px solid rgba(179,136,255,0.18)', cursor:'pointer', background: loading ? 'rgba(255,255,255,0.04)' : 'linear-gradient(135deg, rgba(179,136,255,0.38), rgba(0,200,232,0.75))', color:'white', fontFamily:'var(--font-display)', fontWeight:800, fontSize:12, letterSpacing:'0.03em', boxShadow: loading ? 'none' : '0 12px 26px rgba(0,200,232,0.16)' }}>
              {loading ? 'Analyzing...' : 'Find Genome Match'}
            </button>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', lineHeight:1.6, overflowWrap:'anywhere' }}>
              Search natural language infra requests and compare them against your living registry.
            </div>
          </div>
        </div>

        {featuredGenome && (
          <div style={{ marginBottom:12, padding:'14px 14px 13px', borderRadius:14, background:'radial-gradient(circle at top left, rgba(179,136,255,0.16), rgba(179,136,255,0.05) 32%, rgba(255,255,255,0.02) 100%)', border:'1px solid rgba(179,136,255,0.20)', boxShadow:'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginBottom:10, flexWrap:'wrap' }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:900, color:'var(--text-primary)', fontSize:14, lineHeight:1.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {featuredGenome.title || 'Genome match'}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:5, flexWrap:'wrap' }}>
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:C.purple }}>
                    {featuredGenome.genome_id || 'new pattern'}
                  </span>
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10, padding:'2px 7px', borderRadius:999, background:'rgba(0,230,118,0.08)', color:C.green, border:'1px solid rgba(0,230,118,0.18)' }}>
                    {Math.round((match?.match?.similarity ?? 1) * 100)}% similarity
                  </span>
                </div>
              </div>
              <div style={{ alignSelf:'flex-start', padding:'5px 8px', borderRadius:999, border:'1px solid rgba(0,230,118,0.18)', background:'rgba(0,230,118,0.08)', color:C.green, fontFamily:'var(--font-mono)', fontSize:10, whiteSpace:'nowrap', flexShrink:0 }}>
                {match?.match ? 'live match' : 'latest genome'}
              </div>
            </div>

            <div className="genome-stat-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8, marginBottom:10 }}>
              {[
                ['Success', `${Math.round((featuredGenome.success_rate ?? 0) * 100)}%`],
                ['Runs', `${featuredGenome.success_count ?? 0}`],
                ['Cost', `${Number(featuredGenome.cost_profile?.p50_monthly || 0).toFixed(2)}/mo`],
              ].map(([label, value]) => (
                <div key={label} style={{ padding:'8px 9px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:8, color:'var(--text-muted)', letterSpacing:'0.12em', textTransform:'uppercase' }}>
                    {label}
                  </div>
                  <div style={{ marginTop:4, fontFamily:'var(--font-display)', fontWeight:900, color:'var(--text-primary)', fontSize:12 }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.7, overflowWrap:'anywhere' }}>
              {featuredGenome.semantic_description}
            </div>
          </div>
        )}

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:8, flexWrap:'wrap' }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', letterSpacing:'0.12em', textTransform:'uppercase' }}>
            Registry bundles
          </div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)' }}>
            versioned + reusable
          </div>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:310, overflowY:'auto', paddingRight:2 }}>
          {(registry.items || []).length ? (registry.items || []).map((item, index) => (
            <div key={item.genome_id} style={{ position:'relative', padding:'11px 12px 11px 13px', borderRadius:12, background:index === 0 ? 'linear-gradient(180deg, rgba(0,200,232,0.07), rgba(255,255,255,0.02))' : 'rgba(255,255,255,0.025)', border:index === 0 ? '1px solid rgba(0,200,232,0.18)' : '1px solid rgba(255,255,255,0.06)', overflow:'hidden' }}>
              <div style={{ position:'absolute', left:0, top:0, width:2, height:'100%', background:index === 0 ? C.teal : C.purple, opacity:0.9 }} />
              <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginBottom:6 }}>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:900, color:'var(--text-primary)', fontSize:12, lineHeight:1.2 }}>
                  {item.title}
                </div>
                <div style={{ flexShrink:0, fontFamily:'var(--font-mono)', fontSize:10, color:C.teal, whiteSpace:'nowrap' }}>
                  {Math.round((item.success_rate || 0) * 100)}% success
                </div>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:7 }}>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:9, padding:'2px 7px', borderRadius:999, background:'rgba(255,255,255,0.04)', color:'var(--text-secondary)', border:'1px solid rgba(255,255,255,0.05)' }}>
                  {item.genome_id}
                </span>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:9, padding:'2px 7px', borderRadius:999, background:'rgba(0,230,118,0.08)', color:C.green, border:'1px solid rgba(0,230,118,0.14)' }}>
                  {item.success_count} runs
                </span>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:9, padding:'2px 7px', borderRadius:999, background:'rgba(255,171,64,0.08)', color:C.amber, border:'1px solid rgba(255,171,64,0.14)' }}>
                  ${Number(item.cost_profile?.p50_monthly || 0).toFixed(2)}/mo
                </span>
              </div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', lineHeight:1.55 }}>
                {item.semantic_description}
              </div>
            </div>
          )) : (
            <div style={{ padding:'14px', borderRadius:12, border:'1px dashed rgba(255,255,255,0.10)', color:'var(--text-muted)', fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6, background:'rgba(255,255,255,0.02)' }}>
              No genomes captured yet. Complete one successful deployment to seed the registry.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Live API Tester ───────────────────────────────────────────────────────
function ApiTester({ method, path, defaultBody, description }) {
  const [body, setBody]     = useState(defaultBody || '')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const methodColor = method === 'GET' ? C.green
    : method === 'POST' ? C.teal
    : method === 'WS' ? C.purple : C.amber

  async function run() {
    if (method === 'WS') return
    setLoading(true)
    setResult(null)
    try {
      const opts = { method, headers:{ 'Content-Type':'application/json' } }
      if (method === 'POST' && body) opts.body = body
      const res = await fetch(`${API}${path}`, opts)
      const data = await readJsonResponse(res)
      setResult({ status: res.status, ok: res.ok, data })
    } catch(e) {
      setResult({ status: 0, ok: false, data: { error: e.message } })
    } finally { setLoading(false) }
  }

  return (
    <div style={{ marginBottom:20 }}>
      {/* Header row */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
        <span style={{
          fontSize:11, padding:'3px 10px', borderRadius:5, fontWeight:700,
          fontFamily:'var(--font-mono)', background:`${methodColor}15`,
          color:methodColor, border:`1px solid ${methodColor}35`, flexShrink:0
        }}>{method}</span>
        <code style={{ fontFamily:'var(--font-mono)', fontSize:13,
          color:'var(--text-primary)', flex:1 }}>{API}{path}</code>
        <CopyBtn text={`${API}${path}`} label="Copy URL"/>
        <button onClick={() => setExpanded(e=>!e)} style={{
          fontSize:10, padding:'4px 10px', borderRadius:6, cursor:'pointer',
          background:'rgba(0,200,232,0.06)', border:'1px solid var(--border)',
          color:'var(--text-secondary)'
        }}>{expanded ? 'Close ↑' : 'Try It ↓'}</button>
      </div>

      <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:8, lineHeight:1.6 }}>
        {description}
      </p>

      {/* Expandable tester */}
      {expanded && (
        <div className="anim-fadeUp" style={{
          background:'var(--bg-deep)', borderRadius:10,
          border:'1px solid var(--border)', overflow:'hidden'
        }}>
          {/* Request body */}
          {method === 'POST' && (
            <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:10, fontFamily:'var(--font-mono)',
                color:'var(--text-muted)', marginBottom:6 }}>REQUEST BODY</div>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
                style={{
                  width:'100%', background:'rgba(2,8,16,0.8)',
                  border:'1px solid var(--border)', borderRadius:7,
                  padding:'10px 12px', color:C.cyan,
                  fontFamily:'var(--font-mono)', fontSize:11, resize:'none',
                  outline:'none', boxSizing:'border-box'
                }}/>
            </div>
          )}

          {/* Run button */}
          {method !== 'WS' && (
            <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
              <button onClick={run} disabled={loading} style={{
                padding:'8px 20px', borderRadius:7, cursor:'pointer',
                background: loading ? 'var(--bg-card)' : `linear-gradient(135deg,#005a70,${C.teal})`,
                border:'none', color: loading ? 'var(--text-muted)' : 'white',
                fontFamily:'var(--font-display)', fontWeight:700, fontSize:12
              }}>
                {loading ? '⏳ Sending...' : '▶ Send Request'}
              </button>
            </div>
          )}

          {/* Response */}
          {(result || method === 'WS') && (
            <div style={{ padding:'12px 14px' }}>
              <div style={{ fontSize:10, fontFamily:'var(--font-mono)',
                color:'var(--text-muted)', marginBottom:6 }}>RESPONSE</div>
              {method === 'WS' ? (
                <div style={{ fontFamily:'var(--font-mono)', fontSize:11,
                  color:'var(--text-secondary)' }}>
                  <div style={{ marginBottom:4 }}>// WebSocket messages received:</div>
                  <div style={{ color:C.teal }}>{'{ "type": "state",  "data": { /* full task */ } }'}</div>
                  <div style={{ color:C.teal }}>{'{ "type": "update", "data": { /* full task */ } }'}</div>
                  <div style={{ color:C.teal }}>{'{ "type": "log",    "data": { "message":"...", "level":"info" } }'}</div>
                </div>
              ) : result ? (
                <>
                  <div style={{ marginBottom:8 }}>
                    <span style={{
                      padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700,
                      background: result.ok ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.15)',
                      color: result.ok ? C.green : C.red
                    }}>{result.status} {result.ok ? 'OK' : 'ERROR'}</span>
                  </div>
                  <pre style={{
                    fontFamily:'var(--font-mono)', fontSize:11,
                    color: result.ok ? C.green : C.red,
                    margin:0, whiteSpace:'pre-wrap',
                    maxHeight:200, overflowY:'auto'
                  }}>
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Edge case coverage table ──────────────────────────────────────────────
function EdgeCaseTable() {
  const cases = [
    { cat:'Input',      issue:'Garbage input (non-infra text)',     solution:'Pre-flight validator rejects before execution',  status:'✅' },
    { cat:'Input',      issue:'Dangerous commands (delete all)',     solution:'Pattern matching blocks destructive operations', status:'✅' },
    { cat:'Input',      issue:'Too short / ambiguous',              solution:'Confidence scoring + helpful suggestion shown',   status:'✅' },
    { cat:'Planning',   issue:'Invalid JSON from LLM',              solution:'Schema validation + fallback to rule-based plan', status:'✅' },
    { cat:'Planning',   issue:'Dependency cycle in plan',           solution:"Kahn's algorithm detects cycles pre-execution",   status:'✅' },
    { cat:'Planning',   issue:'No API key / Groq unavailable',      solution:'Smart rule-based planner (works with zero key)',  status:'✅' },
    { cat:'Execution',  issue:'S3 bucket name conflict',            solution:'Verification Agent retries with suffix (-r1/-r2)',status:'✅' },
    { cat:'Execution',  issue:'EC2 capacity unavailable',           solution:'Auto-downgrade instance type + retry',           status:'✅' },
    { cat:'Execution',  issue:'Port already in use',                solution:'Try alternate port (+10 each retry)',             status:'✅' },
    { cat:'Execution',  issue:'Max retries exceeded',               solution:'Hard cap at 3 retries, clear error reported',    status:'✅' },
    { cat:'Execution',  issue:'Parallel race condition',            solution:'Each agent writes to isolated resource namespace',status:'✅' },
    { cat:'Network',    issue:'WebSocket connection drops',         solution:'Auto-reconnect (5 attempts, exponential backoff)',status:'✅' },
    { cat:'Network',    issue:'Client reconnects mid-task',         solution:'State recovered from Redis on WS connect',       status:'✅' },
    { cat:'State',      issue:'Task state partially written',       solution:'Atomic Redis updates, idempotent step upserts',  status:'✅' },
    { cat:'Security',   issue:'Injection via ticket text',          solution:'Shell metacharacter stripping in param sanitiser',status:'✅' },
    { cat:'Security',   issue:'Cost explosion (100 EC2s)',          solution:'MAX_INSTANCES env var enforced pre-execution',   status:'✅' },
    { cat:'Scale',      issue:'1000 concurrent tickets',            solution:'MAX_CONCURRENT_TASKS limit + background queue',  status:'✅' },
    { cat:'UX',         issue:'User gets cryptic error message',    solution:'Structured errors with reason + suggestion',     status:'✅' },
  ]

  const catColor = c => ({
    Input:C.red, Planning:C.teal, Execution:C.amber,
    Network:C.purple, State:C.cyan, Security:'#ff7043', Scale:C.green, UX:C.green
  }[c] || C.teal)

  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse',
        fontFamily:'var(--font-mono)', fontSize:11 }}>
        <thead>
          <tr style={{ borderBottom:'1px solid var(--border)' }}>
            {['Category','Edge Case','How NEXUS OPS Handles It','Status'].map(h => (
              <th key={h} style={{ padding:'8px 12px', textAlign:'left',
                color:'var(--text-muted)', fontWeight:600,
                letterSpacing:'0.07em', fontSize:10 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cases.map((r,i) => (
            <tr key={i} style={{ borderBottom:'1px solid rgba(26,48,80,0.4)' }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(0,200,232,0.03)'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <td style={{ padding:'9px 12px' }}>
                <span style={{
                  fontSize:9, padding:'2px 7px', borderRadius:4,
                  background:`${catColor(r.cat)}15`, color:catColor(r.cat),
                  border:`1px solid ${catColor(r.cat)}30`, fontWeight:600
                }}>{r.cat}</span>
              </td>
              <td style={{ padding:'9px 12px', color:'var(--text-secondary)' }}>{r.issue}</td>
              <td style={{ padding:'9px 12px', color:'var(--text-primary)' }}>{r.solution}</td>
              <td style={{ padding:'9px 12px', color:C.green, fontSize:14 }}>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── System config panel ───────────────────────────────────────────────────
function SystemConfig() {
  const [config, setConfig] = useState(null)

  useEffect(() => {
    fetch(`${API}/api/config`)
      .then(readJsonResponse)
      .then(setConfig)
      .catch(() => setConfig(null))
  }, [])

  const checks = [
    { label:'Service Status', value: config?.service_status || 'loading', color:C.green },
    { label:'LLM',            value: config?.llm_enabled ? 'enabled' : 'missing -> rule-based fallback', color:C.teal },
    { label:'Model',          value:'llama-3.1-8b-instant (Groq free tier)', color:C.teal },
    { label:'Cloud',          value: config?.runtime_mode === 'real' ? 'real AWS' : 'mock execution', color:C.teal },
    { label:'State',          value:'Redis 7 — pub/sub + task store', color:C.amber },
    { label:'Execution Mode', value: config?.runtime_mode || config?.execution_mode || import.meta.env.VITE_EXECUTION_MODE || 'mock', color:C.green },
    { label:'Requested Mode', value: config?.requested_execution_mode || import.meta.env.VITE_EXECUTION_MODE || 'local', color:C.amber },
    { label:'Max Instances',  value:'20 per deployment', color:C.amber },
    { label:'Max Concurrent', value:'10 parallel tasks', color:C.amber },
    { label:'Max Retries',    value:'3 per step (exponential backoff)', color:C.amber },
    { label:'API',            value: `${API}`, color:C.purple },
  ]
  return (
    <div className="panel" style={{ padding:'16px 18px' }}>
      {checks.map((c,i) => (
        <div key={i} style={{
          display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'8px 0',
          borderBottom: i < checks.length-1 ? '1px solid rgba(26,48,80,0.45)' : 'none',
          fontFamily:'var(--font-mono)', fontSize:11
        }}>
          <span style={{ color:'var(--text-muted)' }}>{c.label}</span>
          <span style={{ color:c.color }}>{c.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main Settings page ────────────────────────────────────────────────────
export default function Settings({ tasks }) {
  const liveTasks = tasks.filter(t => t.status === 'completed')
  const [apiKey, setApiKeyState] = useState(getApiKey())
  const [keySaved, setKeySaved]  = useState(false)

  function saveKey() {
    setApiKey(apiKey)
    setKeySaved(true)
    setTimeout(() => setKeySaved(false), 2000)
  }

  return (
    <Page>
      {/* API Key Panel */}
      <div className="panel" style={{ padding:'18px 22px', marginBottom:24, display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#b0bec5', minWidth:120 }}>🔑 API Key</div>
        <input
          value={apiKey}
          onChange={e => setApiKeyState(e.target.value)}
          placeholder="Enter your API key (any string — auto-registers)"
          style={{
            flex:1, minWidth:220, background:'rgba(255,255,255,0.05)',
            border:'1px solid rgba(255,255,255,0.12)', borderRadius:8,
            padding:'8px 14px', color:'#e0e0e0', fontSize:13,
            fontFamily:'var(--font-mono)'
          }}
          onKeyDown={e => e.key === 'Enter' && saveKey()}
        />
        <button onClick={saveKey} style={{
          background: keySaved ? C.green : C.teal, color:'#000', border:'none',
          borderRadius:8, padding:'8px 18px', fontSize:13, fontWeight:700, cursor:'pointer',
          transition:'background 0.3s'
        }}>
          {keySaved ? '✓ Saved' : 'Save'}
        </button>
        <span style={{ fontSize:11, color:'#6b7a8d' }}>
          Use <code style={{ fontFamily:'var(--font-mono)', color:C.amber }}>nexus-admin-key</code> for metrics access
        </span>
      </div>

      <div className="settings-layout" style={{ display:'grid', gridTemplateColumns:'minmax(0, 1fr) minmax(320px, 380px)', gap:24, alignItems:'start' }}>

        {/* Left: API explorer + edge cases */}
        <div className="settings-column" style={{ display:'flex', flexDirection:'column', gap:28, minWidth:0 }}>

          {/* Interactive API explorer */}
          <div>
            <SectionHeader title="INTERACTIVE API EXPLORER" color={C.teal}
              right={<span style={{ fontSize:11, color:'var(--text-secondary)' }}>
                Click "Try It" to run live requests
              </span>}/>
            <div className="panel" style={{ padding:'20px 22px' }}>
              <ApiTester method="POST" path="/api/tickets"
                description="Submit a new infrastructure ticket. Returns task_id instantly. Self-validation rejects garbage input."
                defaultBody={'{\n  "ticket": "Set up a production environment for payments-api with S3 bucket in us-east-1, t2.medium EC2, port 8080"\n}'}/>
              <div style={{ height:1, background:'var(--border)', margin:'4px 0 20px' }}/>
              <ApiTester method="GET" path="/api/tickets"
                description="List all recent tasks (last 20) including steps, outputs, and final reports."/>
              <div style={{ height:1, background:'var(--border)', margin:'4px 0 20px' }}/>
              <ApiTester method="GET" path="/api/health/validate?ticket=Set+up+payments+service+with+S3+and+EC2"
                description="Pre-validate a ticket without executing. Returns confidence score, extracted params, and rejection reason if invalid."/>
              <div style={{ height:1, background:'var(--border)', margin:'4px 0 20px' }}/>
              <ApiTester method="GET" path="/health"
                description="System health check — verifies backend is running."/>
              <div style={{ height:1, background:'var(--border)', margin:'4px 0 20px' }}/>
              <ApiTester method="WS" path="/ws/{task_id}"
                description="WebSocket endpoint. Auto-reconnects on disconnect. State recovered from Redis if connection was lost mid-execution."/>
            </div>
          </div>

          {/* Edge case coverage */}
          <div>
            <SectionHeader title="EDGE CASE COVERAGE" color={C.green}
              right={<span style={{ fontSize:10, padding:'2px 8px', borderRadius:6,
                background:'rgba(0,230,118,0.1)', color:C.green,
                fontFamily:'var(--font-mono)', border:'1px solid rgba(0,230,118,0.2)' }}>
                18 / 18 handled ✅
              </span>}/>
            <div className="panel" style={{ overflow:'hidden' }}>
              <EdgeCaseTable/>
            </div>
          </div>
        </div>

        {/* Right: system config + services + quick start */}
        <div className="settings-column" style={{ display:'flex', flexDirection:'column', gap:20, minWidth:0 }}>
          <div>
            <SectionHeader title="SYSTEM CONFIGURATION" color={C.amber}/>
            <SystemConfig/>
          </div>

          <GenomeRegistryPanel />

          {/* Live service access */}
          {liveTasks.length > 0 && (
            <div>
              <SectionHeader title="ACCESS YOUR SERVICES" color={C.teal} count={liveTasks.length}/>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {liveTasks.map(t => {
                  const cat = getCatalogItem(t)
                  const ep  = getEndpoint(t)
                  const r   = t.final_report?.resources || []
                  const storage = r.find(x => x.type==='S3 Bucket')
                  const compute = r.find(x => x.type==='EC2 Instance')
                  return (
                    <div key={t.task_id} className="panel-card" style={{ padding:'14px 16px' }}>
                      <div style={{ display:'flex', alignItems:'center',
                        gap:10, marginBottom:10 }}>
                        <span style={{ fontSize:18 }}>{cat?.icon||'⚙️'}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontFamily:'var(--font-display)', fontWeight:700,
                            fontSize:13, color:'var(--text-primary)' }}>
                            {t.final_report?.service_name || cat?.name}
                          </div>
                          <div style={{ fontSize:9, fontFamily:'var(--font-mono)',
                            color:cat?.color||C.teal, textTransform:'uppercase' }}>
                            {t.final_report?.environment || cat?.env}
                          </div>
                        </div>
                        <div style={{ width:6, height:6, borderRadius:'50%',
                          background:C.green, boxShadow:`0 0 6px ${C.green}` }}/>
                      </div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:10, lineHeight:2 }}>
                        {ep && <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ color:'var(--text-muted)' }}>endpoint</span>
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            <span style={{ color:C.cyan }}>{ep}</span>
                            <CopyBtn text={ep}/>
                          </div>
                        </div>}
                        {compute && <div style={{ display:'flex', justifyContent:'space-between' }}>
                          <span style={{ color:'var(--text-muted)' }}>instance</span>
                          <span style={{ color:'var(--text-secondary)' }}>{compute.id}</span>
                        </div>}
                        {storage && <div style={{ display:'flex', justifyContent:'space-between' }}>
                          <span style={{ color:'var(--text-muted)' }}>bucket</span>
                          <span style={{ color:'var(--text-secondary)' }}>{storage.name}</span>
                        </div>}
                        {ep && <div style={{ paddingTop:6, borderTop:'1px solid var(--border)' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ color:C.cyan, fontSize:9 }}>curl {ep}/health</span>
                            <CopyBtn text={`curl ${ep}/health`}/>
                          </div>
                        </div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Free LLM note */}
          <div className="panel" style={{ padding:'14px 16px' }}>
            <div style={{ fontSize:11, fontFamily:'var(--font-display)', fontWeight:700,
              color:C.teal, marginBottom:10 }}>🆓 FREE LLM SETUP</div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:10, lineHeight:1.9,
              color:'var(--text-secondary)' }}>
              <div>1. Go to <span style={{color:C.teal}}>console.groq.com</span></div>
              <div>2. Sign up free (no credit card)</div>
              <div>3. Create API key</div>
              <div>4. Add to <span style={{color:C.amber}}>.env</span>:</div>
              <div style={{ marginTop:6, padding:'6px 10px', borderRadius:6,
                background:'rgba(2,8,16,0.8)', border:'1px solid var(--border)',
                color:C.cyan }}>
                GROQ_API_KEY=gsk_...
              </div>
              <div style={{ marginTop:8, color:C.green }}>
                ✓ Without key: rule-based planner runs automatically
              </div>
            </div>
          </div>
        </div>
      </div>
    </Page>
  )
}

