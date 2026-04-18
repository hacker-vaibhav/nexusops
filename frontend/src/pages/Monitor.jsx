// pages/Monitor.jsx
import { useState, useEffect } from 'react'
import { getCatalogItem, getEndpoint, estimateCost, STATUS_COLOR, timeAgo } from '../shared/store'
import { SectionHeader, HealthDot, Sparkline, LogStream, CopyBtn, Page, EmptyState } from '../components/UI'
import { cancelTicket } from '../utils/api'

const C = { teal:'#00c8e8', green:'#00e676', amber:'#ffab40', red:'#ff5252', purple:'#b388ff' }

// Generate fake historical health data
function useHealthHistory(active) {
  const [history, setHistory] = useState(() =>
    Array.from({ length: 30 }, (_, i) => ({
      time: new Date(Date.now() - (30 - i) * 10000).toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}),
      latency: Math.floor(Math.random() * 60 + 18),
      status: Math.random() > 0.05 ? 'up' : 'degraded'
    }))
  )

  useEffect(() => {
    if (!active) return
    const iv = setInterval(() => {
      setHistory(prev => [...prev.slice(1), {
        time: new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}),
        latency: Math.floor(Math.random() * 60 + 18),
        status: Math.random() > 0.04 ? 'up' : 'degraded'
      }])
    }, 3000)
    return () => clearInterval(iv)
  }, [active])

  return history
}

function LatencyChart({ data, color }) {
  const w = 600, h = 80
  const latencies = data.map(d => d.latency)
  const max = Math.max(...latencies), min = Math.min(...latencies)
  const norm = v => h - ((v - min) / (max - min + 1)) * (h - 8) - 4

  const pathD = data.map((d,i) =>
    `${i===0?'M':'L'}${(i/(data.length-1))*w},${norm(d.latency)}`
  ).join(' ')

  const areaD = pathD + ` L${w},${h} L0,${h} Z`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width:'100%', height:80, display:'block' }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color || C.teal} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={color || C.teal} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#areaGrad)"/>
      <path d={pathD} fill="none" stroke={color || C.teal} strokeWidth="2"/>
      {/* Last point dot */}
      {data.length > 0 && (
        <circle
          cx={w}
          cy={norm(data[data.length-1].latency)}
          r="4" fill={color || C.teal}
          style={{ filter:`drop-shadow(0 0 4px ${color || C.teal})` }}
        />
      )}
    </svg>
  )
}

function ServicePanel({ task }) {
  const cat      = getCatalogItem(task)
  const ep       = getEndpoint(task)
  const cost     = estimateCost(task)
  const isLive   = task.status === 'completed'
  const [cancelling, setCancelling] = useState(false)
  const [cancelMsg,  setCancelMsg]  = useState(null)
  const isActive = ['planning','executing','running','pending','queued'].includes(task.status)

  async function handleCancel() {
    if (!window.confirm('Cancel this task? Any created resources will be rolled back.')) return
    setCancelling(true)
    try {
      await cancelTicket(task.task_id)
      setCancelMsg('Cancellation requested — rollback in progress...')
    } catch(e) {
      setCancelMsg('Could not cancel: ' + (e.message || 'unknown error'))
    } finally { setCancelling(false) }
  }
  const color    = cat?.color || C.teal
  const history  = useHealthHistory(isLive)
  const upCount  = history.filter(h => h.status === 'up').length
  const uptime   = ((upCount / history.length) * 100).toFixed(1)
  const avgLat   = Math.round(history.reduce((s,h) => s+h.latency,0) / history.length)
  const svcName  = task.final_report?.service_name || cat?.name || 'Service'
  const env      = task.final_report?.environment  || cat?.env  || 'unknown'

  const resources = task.final_report?.resources || []
  const storage = resources.find(r => r.type === 'S3 Bucket')
  const compute = resources.find(r => r.type === 'EC2 Instance')
  const service = resources.find(r => r.type === 'Service')

  return (
    <div className="anim-fadeUp" style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Service header */}
      <div className="panel" style={{ padding:'18px 22px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div style={{
            width:48, height:48, borderRadius:13, flexShrink:0,
            background:`${color}15`, border:`1px solid ${color}35`,
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:24
          }}>{cat?.icon || '⚙️'}</div>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
              <span style={{ fontFamily:'var(--font-display)', fontWeight:700,
                fontSize:18, color:'var(--text-primary)' }}>{svcName}</span>
              <span style={{
                fontSize:10, padding:'2px 8px', borderRadius:8,
                fontFamily:'var(--font-mono)', textTransform:'uppercase',
                background:`${color}15`, color, border:`1px solid ${color}30`
              }}>{env}</span>
            </div>
            <HealthDot active={isLive} showLatency/>
          </div>
          {/* Uptime stats */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:20 }}>
            {[
              { label:'UPTIME',   value:`${uptime}%`,   color: parseFloat(uptime)>95 ? C.green : C.amber },
              { label:'AVG PING', value:`${avgLat}ms`,  color: C.teal },
              { label:'TASK',     value:task.task_id,   color: C.purple, mono:true },
            ].map(s => (
              <div key={s.label} style={{ textAlign:'right' }}>
                <div style={{
                  fontFamily: s.mono ? 'var(--font-mono)' : 'var(--font-display)',
                  fontWeight:700, fontSize: s.mono ? 11 : 18, color:s.color
                }}>{s.value}</div>
                <div style={{ fontSize:9, color:'var(--text-muted)',
                  fontFamily:'var(--font-mono)', letterSpacing:'0.07em' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Cancel button + message */}
        {(isActive || cancelMsg) && (
          <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:12 }}>
            {isActive && (
              <button onClick={handleCancel} disabled={cancelling} style={{
                background:'rgba(255,82,82,0.12)', border:'1px solid rgba(255,82,82,0.4)',
                color:'#ff5252', borderRadius:8, padding:'7px 18px', fontSize:12,
                fontWeight:700, cursor:'pointer', fontFamily:'var(--font-mono)'
              }}>
                {cancelling ? 'Cancelling...' : '✕ Cancel Task'}
              </button>
            )}
            {cancelMsg && (
              <span style={{ fontSize:12, color:'#ffab40' }}>{cancelMsg}</span>
            )}
          </div>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {/* Latency chart */}
        <div className="panel" style={{ padding:'16px 20px' }}>
          <div style={{ display:'flex', alignItems:'center',
            justifyContent:'space-between', marginBottom:12 }}>
            <span style={{ fontSize:10, fontFamily:'var(--font-mono)',
              color:'var(--text-muted)', letterSpacing:'0.08em' }}>
              LATENCY (30 samples · 3s interval)
            </span>
            <span style={{ fontSize:11, fontFamily:'var(--font-mono)', color }}>
              {history[history.length-1]?.latency}ms
            </span>
          </div>
          <LatencyChart data={history} color={color}/>
          <div style={{ display:'flex', justifyContent:'space-between',
            marginTop:6, fontSize:9, fontFamily:'var(--font-mono)',
            color:'var(--text-muted)' }}>
            <span>{history[0]?.time}</span>
            <span>{history[history.length-1]?.time}</span>
          </div>
        </div>

        {/* Health history table */}
        <div className="panel" style={{ padding:'16px 20px' }}>
          <div style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--text-muted)',
            letterSpacing:'0.08em', marginBottom:10 }}>
            HEALTH CHECK HISTORY
          </div>
          <div style={{ overflowY:'auto', maxHeight:140 }}>
            {history.slice(-10).reverse().map((h,i) => (
              <div key={i} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'5px 0',
                borderBottom: i < 9 ? '1px solid rgba(26,48,80,0.5)' : 'none'
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ width:5, height:5, borderRadius:'50%',
                    background: h.status==='up' ? C.green : C.amber }}/>
                  <span style={{ fontSize:10, fontFamily:'var(--font-mono)',
                    color: h.status==='up' ? C.green : C.amber }}>
                    {h.status.toUpperCase()}
                  </span>
                </div>
                <span style={{ fontSize:10, fontFamily:'var(--font-mono)',
                  color:'var(--text-muted)' }}>{h.time}</span>
                <span style={{ fontSize:10, fontFamily:'var(--font-mono)',
                  color:C.teal }}>{h.latency}ms</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Resource inventory + endpoint */}
      {ep && (
        <div className="panel" style={{ padding:'16px 20px' }}>
          <div style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--text-muted)',
            letterSpacing:'0.08em', marginBottom:12 }}>
            ACCESS INFORMATION
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {[
              { label:'HTTP Endpoint', value:ep,                         icon:'🌐' },
              { label:'Health Check',  value:`${ep}/health`,             icon:'❤️' },
              { label:'S3 Bucket',     value: storage?.arn || '—',       icon:'🗄' },
            ].map((r,i) => (
              <div key={i} style={{
                background:'var(--bg-deep)', borderRadius:8,
                border:'1px solid var(--border)', padding:'10px 12px'
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                  <span style={{ fontSize:14 }}>{r.icon}</span>
                  <span style={{ fontSize:9, fontFamily:'var(--font-mono)',
                    color:'var(--text-muted)', letterSpacing:'0.06em' }}>{r.label}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center',
                  justifyContent:'space-between', gap:8 }}>
                  <span style={{ fontSize:10, fontFamily:'var(--font-mono)',
                    color:C.cyan, overflow:'hidden', textOverflow:'ellipsis',
                    whiteSpace:'nowrap', flex:1 }}>
                    {r.value}
                  </span>
                  <CopyBtn text={r.value} label="Copy"/>
                </div>
              </div>
            ))}
          </div>
          {/* curl command */}
          <div style={{
            marginTop:12, background:'rgba(2,8,16,0.8)',
            borderRadius:8, padding:'10px 14px',
            fontFamily:'var(--font-mono)', fontSize:11,
            border:'1px solid var(--border)',
            display:'flex', alignItems:'center', justifyContent:'space-between'
          }}>
            <span style={{ color:C.cyan }}>$ curl {ep}/health</span>
            <CopyBtn text={`curl ${ep}/health`} label="Copy"/>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Monitor({ tasks }) {
  const live = tasks.filter(t => t.status === 'completed')
  const [selected, setSelected] = useState(null)

  const selectedTask = selected
    ? tasks.find(t => t.task_id === selected)
    : live[0] || null

  if (live.length === 0) {
    return (
      <Page>
        <EmptyState icon="📡" title="No services to monitor"
          body="Deploy a service first to see live health metrics, latency graphs, and access information here."/>
      </Page>
    )
  }

  return (
    <Page>
      {/* Service selector */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
        <span style={{ fontSize:11, fontFamily:'var(--font-mono)',
          color:'var(--text-muted)', letterSpacing:'0.08em', flexShrink:0 }}>
          MONITORING:
        </span>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {live.map(t => {
            const cat = getCatalogItem(t)
            const isActive = (selected ? selected === t.task_id : t === live[0])
            return (
              <button key={t.task_id}
                onClick={() => setSelected(t.task_id)}
                style={{
                  display:'flex', alignItems:'center', gap:8,
                  padding:'7px 14px', borderRadius:9, cursor:'pointer',
                  background: isActive ? `${cat?.color || C.teal}15` : 'var(--bg-card)',
                  border:`1px solid ${isActive ? (cat?.color || C.teal) : 'var(--border)'}`,
                  color: isActive ? (cat?.color || C.teal) : 'var(--text-secondary)',
                  fontFamily:'var(--font-display)', fontWeight:700, fontSize:12,
                  transition:'all 0.15s'
                }}>
                <span style={{ fontSize:15 }}>{cat?.icon || '⚙️'}</span>
                {t.final_report?.service_name || cat?.name || t.task_id}
              </button>
            )
          })}
        </div>
      </div>

      {selectedTask && <ServicePanel task={selectedTask}/>}
    </Page>
  )
}
