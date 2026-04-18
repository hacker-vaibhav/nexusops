// pages/Observability.jsx — metrics dashboard + per-task trace viewer
import { useState, useEffect } from 'react'
import { fetchMetrics, fetchTrace } from '../utils/api'
import { SectionHeader, Page } from '../components/UI'

const C = { teal:'#00c8e8', green:'#00e676', amber:'#ffab40', red:'#ff5252', muted:'#6b7a8d' }

function MetricCard({ label, value, unit = '', color = C.teal }) {
  return (
    <div style={{
      background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:10, padding:'16px 20px', minWidth:140
    }}>
      <div style={{ fontSize:11, color:C.muted, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.08em' }}>
        {label}
      </div>
      <div style={{ fontSize:28, fontWeight:700, color, fontFamily:'var(--font-mono)' }}>
        {value ?? '—'}<span style={{ fontSize:14, fontWeight:400, color:C.muted, marginLeft:4 }}>{unit}</span>
      </div>
    </div>
  )
}

function LatencyBar({ tool, stats }) {
  const max = stats?.p99 || 1
  const barColor = tool === 'create_storage' ? C.teal : tool === 'allocate_compute' ? C.amber : C.green
  const labels = { create_storage:'S3 Bucket', allocate_compute:'EC2 Compute', deploy_service:'Deploy Service' }

  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
        <span style={{ fontSize:12, color:'#b0bec5', fontWeight:600 }}>{labels[tool] || tool}</span>
        <span style={{ fontSize:11, color:C.muted, fontFamily:'var(--font-mono)' }}>
          {stats?.samples ?? 0} samples
        </span>
      </div>
      {stats && stats.p50 !== null ? (
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {[['p50', stats.p50, 0.6], ['p95', stats.p95, 0.85], ['p99', stats.p99, 1.0]].map(([label, val, opacity]) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:10, color:C.muted, width:28, fontFamily:'var(--font-mono)' }}>{label}</span>
              <div style={{ flex:1, background:'rgba(255,255,255,0.05)', borderRadius:3, height:8 }}>
                <div style={{
                  width:`${(val / max) * 100}%`, height:'100%',
                  background:barColor, opacity, borderRadius:3,
                  transition:'width 0.5s ease'
                }}/>
              </div>
              <span style={{ fontSize:10, color: barColor, fontFamily:'var(--font-mono)', width:60, textAlign:'right' }}>
                {val?.toFixed(0)}ms
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize:11, color:C.muted }}>No data yet — run some tasks first</div>
      )}
    </div>
  )
}

function TraceViewer() {
  const [taskId, setTaskId] = useState('')
  const [trace, setTrace]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)

  async function load() {
    if (!taskId.trim()) return
    setLoading(true); setError(null)
    try {
      const t = await fetchTrace(taskId.trim())
      if (!t) setError('No trace found — task may still be running or not exist')
      else setTrace(t)
    } catch {
      setError('Could not load trace')
    } finally { setLoading(false) }
  }

  const totalMs = trace?.total_ms || 0

  return (
    <div>
      <div style={{ display:'flex', gap:10, marginBottom:20 }}>
        <input
          value={taskId} onChange={e => setTaskId(e.target.value)}
          placeholder="Enter task ID (e.g. TK-AB12CD34)"
          style={{
            flex:1, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.12)',
            borderRadius:8, padding:'10px 14px', color:'#e0e0e0', fontSize:13,
            fontFamily:'var(--font-mono)'
          }}
          onKeyDown={e => e.key === 'Enter' && load()}
        />
        <button onClick={load} disabled={loading} style={{
          background:C.teal, color:'#000', border:'none', borderRadius:8,
          padding:'10px 20px', fontSize:13, fontWeight:700, cursor:'pointer'
        }}>
          {loading ? 'Loading...' : 'Load Trace'}
        </button>
      </div>

      {error && <div style={{ color:C.red, fontSize:12, marginBottom:12 }}>{error}</div>}

      {trace && (
        <div>
          <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
            <MetricCard label="Total time" value={totalMs.toFixed(0)} unit="ms" color={C.teal} />
            <MetricCard label="Steps" value={trace.span_count} color={C.green} />
            <MetricCard label="Task ID" value={trace.task_id?.slice(-8)} color={C.amber} />
          </div>

          {/* Gantt-style timeline */}
          <div style={{ marginTop:8 }}>
            <div style={{ fontSize:11, color:C.muted, marginBottom:10, textTransform:'uppercase', letterSpacing:'0.06em' }}>
              Step timeline
            </div>
            {trace.spans?.map(span => {
              const left  = (span.offset_ms / totalMs) * 100
              const width = Math.max((span.duration_ms / totalMs) * 100, 1.5)
              const color = span.status === 'completed' ? C.green : span.status === 'failed' ? C.red : C.amber
              const toolShort = span.tool.replace('_', ' ')
              return (
                <div key={span.step_id} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                  <div style={{ width:130, fontSize:11, color:'#b0bec5', textAlign:'right', flexShrink:0 }}>
                    {toolShort}
                  </div>
                  <div style={{ flex:1, background:'rgba(255,255,255,0.05)', borderRadius:4, height:20, position:'relative' }}>
                    <div style={{
                      position:'absolute', left:`${left}%`, width:`${width}%`,
                      height:'100%', background:color, borderRadius:4, opacity:0.85,
                    }}/>
                  </div>
                  <div style={{ width:70, fontSize:10, color, fontFamily:'var(--font-mono)', textAlign:'right', flexShrink:0 }}>
                    {span.duration_ms.toFixed(0)}ms
                    {span.retries > 0 && <span style={{ color:C.amber }}> ×{span.retries+1}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Observability() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    async function load() {
      const m = await fetchMetrics()
      if (mounted) { setMetrics(m); setLoading(false) }
    }
    load()
    const iv = setInterval(load, 10000)
    return () => { mounted = false; clearInterval(iv) }
  }, [])

  const c = metrics?.counters || {}
  const lat = metrics?.latency || {}

  return (
    <Page>
      <SectionHeader
        title="Observability"
        subtitle="Live metrics, latency percentiles, and step-level traces"
      />

      {loading ? (
        <div style={{ color:C.muted, fontSize:13 }}>Loading metrics...</div>
      ) : !metrics ? (
        <div style={{ color:C.amber, fontSize:13 }}>
          Metrics require admin access (set X-API-Key to the admin key in Settings)
        </div>
      ) : (
        <>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:28 }}>
            <MetricCard label="Total tasks"     value={c['tasks.total']?.toFixed(0) ?? 0}     color={C.teal}  />
            <MetricCard label="Completed"       value={c['tasks.completed']?.toFixed(0) ?? 0} color={C.green} />
            <MetricCard label="Failed"          value={c['tasks.failed']?.toFixed(0) ?? 0}    color={C.red}   />
            <MetricCard label="Cancelled"       value={c['tasks.cancelled']?.toFixed(0) ?? 0} color={C.amber} />
            <MetricCard label="Queue depth"     value={metrics.queue_depth ?? 0}               color={C.muted} />
          </div>

          <div style={{ marginBottom:28 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:16, textTransform:'uppercase', letterSpacing:'0.08em' }}>
              Step latency (p50 / p95 / p99)
            </div>
            {['create_storage','allocate_compute','deploy_service'].map(tool => (
              <LatencyBar key={tool} tool={tool} stats={lat[tool]} />
            ))}
          </div>

          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:16, textTransform:'uppercase', letterSpacing:'0.08em' }}>
              Task trace viewer
            </div>
            <TraceViewer />
          </div>
        </>
      )}
    </Page>
  )
}
