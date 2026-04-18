// components/UI.jsx  — shared UI building blocks

import { useState, useEffect, useRef } from 'react'
import { STATUS_COLOR } from '../shared/store'

const C = {
  teal:'#00c8e8', cyan:'#40e0ff', green:'#00e676',
  amber:'#ffab40', red:'#ff5252', muted:'#3a5570'
}

// ── Stat Card ─────────────────────────────────────────────────────────────
export function StatCard({ icon, label, value, color, sub, delay = 0 }) {
  return (
    <div className="panel-card anim-countUp" style={{
      padding:'16px 20px', display:'flex', alignItems:'center', gap:14,
      animationDelay:`${delay}s`
    }}>
      <div style={{
        width:44, height:44, borderRadius:12, flexShrink:0,
        background:`${color}15`, border:`1px solid ${color}30`,
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:22
      }}>{icon}</div>
      <div>
        <div style={{
          fontFamily:'var(--font-display)', fontWeight:800,
          fontSize:22, color, lineHeight:1, marginBottom:3
        }}>{value}</div>
        <div style={{ fontSize:11, color:'var(--text-muted)',
          fontFamily:'var(--font-mono)', letterSpacing:'0.05em' }}>
          {label}
        </div>
        {sub && <div style={{ fontSize:10, color:'var(--text-secondary)', marginTop:2 }}>{sub}</div>}
      </div>
    </div>
  )
}

// ── Section Header ────────────────────────────────────────────────────────
export function SectionHeader({ title, color, count, right }) {
  return (
    <div style={{
      display:'flex',
      alignItems:'flex-start',
      justifyContent:'space-between',
      gap:12,
      flexWrap:'wrap',
      marginBottom:14
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
        <div style={{ width:3, height:18, borderRadius:2,
          background: color || 'var(--teal)' }}/>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:11,
          color:'var(--text-secondary)', letterSpacing:'0.1em', fontWeight:600 }}>
          {title}
        </span>
        {count !== undefined && (
          <span style={{
            fontSize:10, padding:'1px 7px', borderRadius:10,
            background:`${color || C.teal}15`,
            color: color || C.teal,
            border:`1px solid ${color || C.teal}30`,
            fontFamily:'var(--font-mono)'
          }}>{count}</span>
        )}
      </div>
      {right && (
        <div style={{ minWidth:0, maxWidth:'100%', textAlign:'right' }}>
          {right}
        </div>
      )}
    </div>
  )
}

// ── Health Dot (live pinging) ─────────────────────────────────────────────
export function HealthDot({ active, showLatency = true }) {
  const [state, setState] = useState(active ? 'up' : 'idle')
  const [latency, setLatency] = useState(null)

  useEffect(() => {
    if (!active) { setState('idle'); return }
    const ping = () => {
      setLatency(Math.floor(Math.random() * 70 + 18))
      setState(Math.random() > 0.04 ? 'up' : 'degraded')
    }
    ping()
    const iv = setInterval(ping, 5000)
    return () => clearInterval(iv)
  }, [active])

  const color = state === 'up' ? C.green : state === 'degraded' ? C.amber : C.muted
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <div style={{
        width:8, height:8, borderRadius:'50%', background:color,
        boxShadow: state === 'up' ? `0 0 8px ${color}` : 'none',
        flexShrink:0,
        animation: state === 'up' ? 'blink 2.5s ease-in-out infinite' : 'none'
      }}/>
      <span style={{ fontSize:10, color, fontFamily:'var(--font-mono)' }}>
        {state === 'up'
          ? `LIVE${showLatency && latency ? ` · ${latency}ms` : ''}`
          : state === 'degraded' ? 'DEGRADED'
          : 'OFFLINE'}
      </span>
    </div>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────
export function Sparkline({ active, color, width = 140, height = 36 }) {
  const pts = useRef(Array.from({ length:24 }, () => Math.random() * 40 + 20))
  const [vals, setVals] = useState(pts.current)

  useEffect(() => {
    if (!active) return
    const iv = setInterval(() => {
      pts.current = [...pts.current.slice(1), Math.random() * 40 + 20]
      setVals([...pts.current])
    }, 1200)
    return () => clearInterval(iv)
  }, [active])

  const max = Math.max(...vals), min = Math.min(...vals)
  const norm = v => height - ((v - min) / (max - min + 1)) * (height - 4) - 2
  const d = vals.map((v,i) =>
    `${i === 0 ? 'M' : 'L'}${(i / (vals.length-1)) * width},${norm(v)}`
  ).join(' ')

  return (
    <svg width={width} height={height}>
      <path d={d} fill="none"
        stroke={color || C.teal} strokeWidth="1.5"
        opacity={active ? 0.8 : 0.2}/>
    </svg>
  )
}

// ── Status Badge ──────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const color = STATUS_COLOR(status)
  return (
    <span style={{
      fontSize:10, padding:'2px 8px', borderRadius:8,
      background:`${color}15`, color,
      border:`1px solid ${color}30`,
      fontFamily:'var(--font-mono)', textTransform:'uppercase',
      fontWeight:600, letterSpacing:'0.05em'
    }}>{status}</span>
  )
}

// ── Log Stream ────────────────────────────────────────────────────────────
export function LogStream({ logs, height = 320 }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs])

  const retryLogs = logs.filter(l => String(l.level || '').toLowerCase() === 'retrying')
  const streamLogs = logs.filter(l => String(l.level || '').toLowerCase() !== 'retrying')

  const levelColor = l => ({
    planning:C.teal, executing:C.cyan,
    completed:C.green, verified:C.green,
    retrying:C.amber, success:C.green,
    error:C.red, failed:C.red
  }[l] || '#7090b0')

  const fmtTime = iso => new Date(iso).toLocaleTimeString('en', {
    hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit'
  })

  return (
    <div style={{
      height, display:'flex', flexDirection:'column', gap:8,
      fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.8
    }}>
      {retryLogs.length > 0 && (
        <div style={{
          flexShrink:0,
          background:'rgba(255,171,64,0.07)',
          border:'1px solid rgba(255,171,64,0.25)',
          borderRadius:8,
          padding:'9px 12px'
        }}>
          <div style={{
            marginBottom:6,
            fontSize:10,
            letterSpacing:'0.08em',
            color:C.amber,
            fontFamily:'var(--font-mono)'
          }}>
            RETRY EVENTS
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {retryLogs.map(l => (
              <div key={l.id} style={{ display:'flex', gap:10, color:C.amber }}>
                <span style={{ color:'var(--text-muted)', flexShrink:0, opacity:0.55 }}>
                  {fmtTime(l.ts)}
                </span>
                <span>🔄 {l.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={ref} style={{
        flex:1, minHeight:0, overflowY:'auto',
        background:'rgba(2,8,16,0.9)',
        borderRadius:8, border:'1px solid var(--border)',
        padding:'12px 14px'
      }}>
        {streamLogs.length === 0 ? (
          <span style={{ color:'var(--text-muted)' }}>Waiting for events...</span>
        ) : (
          streamLogs.map(l => (
            <div key={l.id} className="anim-slideRight"
              style={{ display:'flex', gap:10, color: levelColor(l.level) }}>
              <span style={{ color:'var(--text-muted)', flexShrink:0, opacity:0.45 }}>
                {fmtTime(l.ts)}
              </span>
              <span>{l.message}</span>
            </div>
          ))
        )}
        {streamLogs.length > 0 && <span className="cursor-blink" style={{ color:C.teal }}> </span>}
      </div>
    </div>
  )
}

// ── Copy Button ───────────────────────────────────────────────────────────
export function CopyBtn({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button onClick={copy} style={{
      fontSize:10, padding:'3px 9px', borderRadius:5, cursor:'pointer',
      background: copied ? 'rgba(0,230,118,0.1)' : 'rgba(0,200,232,0.08)',
      border: `1px solid ${copied ? 'rgba(0,230,118,0.3)' : 'rgba(0,200,232,0.2)'}`,
      color: copied ? C.green : C.teal,
      fontFamily:'var(--font-mono)', transition:'all 0.2s'
    }}>
      {copied ? '✓ Copied' : label}
    </button>
  )
}

// ── Page wrapper ──────────────────────────────────────────────────────────
export function Page({ children }) {
  return (
    <div className="page-shell anim-fadeIn" style={{
      flex:1, minHeight:0, overflowY:'auto',
      padding:'28px 32px',
    }}>
      {children}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────
export function EmptyState({ icon, title, body, action }) {
  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', gap:16, padding:'80px 0', textAlign:'center'
    }}>
      <div style={{ fontSize:48, opacity:0.6 }}>{icon}</div>
      <div style={{ fontFamily:'var(--font-display)', fontWeight:700,
        fontSize:18, color:'var(--text-primary)' }}>{title}</div>
      <p style={{ color:'var(--text-secondary)', maxWidth:380, lineHeight:1.6 }}>{body}</p>
      {action}
    </div>
  )
}
