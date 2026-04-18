/**
 * ExecutionGraph.tsx — Adaptive Intelligence Execution Graph v3
 *
 * CHANGES FROM v2:
 * - Full-width horizontal layout (no overlapping nodes)
 * - Nodes spaced across the canvas in a clear left→right flow
 * - Log-synchronized: each log entry drives the active node highlight
 * - Compact height that works inside the Deploy panel
 * - Framer Motion animations, SVG Bézier edges, photon pulses
 *
 * DROP-IN: same props <ExecutionGraph task={task} logs={logs} />
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  teal:   '#00c8e8',
  cyan:   '#40e0ff',
  green:  '#00e676',
  amber:  '#ffab40',
  red:    '#ff5252',
  purple: '#b388ff',
  muted:  '#2a3f52',
}

// ─── Node metadata — horizontal layout positions ──────────────────────────────
// x is percentage of canvas width, y is fixed vertical center
const NODES: Record<string, {
  label: string; short: string; icon: string; accent: string; x: number
}> = {
  master:           { label: 'Master Agent', short: 'Master',  icon: '🧠', accent: C.teal,   x: 7   },
  create_storage:   { label: 'S3 Storage',   short: 'Storage', icon: '🗄', accent: C.cyan,   x: 27  },
  allocate_compute: { label: 'EC2 Compute',  short: 'Compute', icon: '⚙',  accent: C.purple, x: 27  },
  deploy_service:   { label: 'Deploy',       short: 'Deploy',  icon: '🚀', accent: C.amber,  x: 64  },
  verify:           { label: 'Verify',       short: 'Verify',  icon: '✅', accent: C.green,  x: 90  },
}

// Vertical positions for the two parallel nodes
const NODE_Y: Record<string, number> = {
  master:           50,
  create_storage:   24,
  allocate_compute: 76,
  deploy_service:   50,
  verify:           50,
}

// ─── Edges ────────────────────────────────────────────────────────────────────
const EDGES = [
  { from: 'master',          to: 'create_storage',   color: C.teal,   speed: 2.0, delay: 0.0  },
  { from: 'master',          to: 'allocate_compute',  color: C.cyan,   speed: 2.3, delay: 0.45 },
  { from: 'create_storage',  to: 'deploy_service',   color: C.purple, speed: 2.1, delay: 0.2  },
  { from: 'allocate_compute',to: 'deploy_service',   color: C.cyan,   speed: 1.9, delay: 0.65 },
  { from: 'deploy_service',  to: 'verify',           color: C.green,  speed: 2.0, delay: 0.35 },
]

// ─── Log keyword → node mapping ───────────────────────────────────────────────
const LOG_TO_NODE: [RegExp, string][] = [
  [/storage|s3|bucket/i,          'create_storage'],
  [/compute|ec2|instance|cpu/i,   'allocate_compute'],
  [/deploy|service|container|docker|port/i, 'deploy_service'],
  [/verif|health|check|endpoint/i,'verify'],
  [/master|plan|orchestrat/i,     'master'],
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sc(status?: string): string {
  return ({
    pending:   C.muted,
    queued:    C.muted,
    planning:  C.teal,
    running:   C.cyan,
    executing: C.cyan,
    retrying:  C.amber,
    completed: C.green,
    verified:  C.green,
    failed:    C.red,
    cancelled: C.red,
  } as Record<string, string>)[status || ''] ?? C.muted
}
const isDone    = (s?: string) => ['completed','verified'].includes(s||'')
const isFailed  = (s?: string) => ['failed','cancelled'].includes(s||'')
const isRunning = (s?: string) => ['running','executing','planning','retrying'].includes(s||'')

function useTick(active: boolean) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!active) return
    const iv = setInterval(() => setT(v => v + 1), 900)
    return () => clearInterval(iv)
  }, [active])
  return t
}

// ─── Burst ring component ─────────────────────────────────────────────────────
function Burst({ color, go }: { color: string; go: number }) {
  return (
    <AnimatePresence>
      {go > 0 && (
        <motion.div
          key={go}
          style={{
            position: 'absolute', top: '50%', left: '50%',
            width: 96, height: 96,
            marginTop: -48, marginLeft: -48,
            borderRadius: '50%',
            border: `2px solid ${color}`,
            pointerEvents: 'none', zIndex: 20,
          }}
          initial={{ scale: 0.4, opacity: 0.95 }}
          animate={{ scale: 2.8, opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      )}
    </AnimatePresence>
  )
}

// ─── Single node ──────────────────────────────────────────────────────────────
function Node({
  nodeKey, status, active, logHighlight, tick, latency, size,
}: {
  nodeKey: string; status?: string; active: boolean; logHighlight: boolean; tick: number; latency: string; size: number
}) {
  const meta    = NODES[nodeKey]
  const color   = sc(status)
  const done    = isDone(status)
  const failed  = isFailed(status)
  const retry   = status === 'retrying'
  const prevRef = useRef<string | undefined>(undefined)
  const [burst, setBurst] = useState(0)
  const glowing = active || logHighlight

  useEffect(() => {
    if (prevRef.current !== status && (active || done || failed)) {
      setBurst(b => b + 1)
    }
    prevRef.current = status
  }, [status, active, done, failed])

  const SIZE = size

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, position: 'relative' }}>
      {/* Node circle */}
      <motion.div
        style={{ position: 'relative', width: SIZE, height: SIZE }}
        animate={{
          scale: active ? 1.08 : logHighlight ? 1.05 : done ? 1.02 : 1,
          y: active ? [0, -4, 0] : failed ? [0, -4, 4, -3, 0] : 0,
        }}
        transition={{
          scale: { duration: 0.25 },
          y: active
            ? { duration: 2.0, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }
            : { duration: 0.45 },
        }}
      >
        {/* Pulse rings when active */}
        {[0, 1, 2].map(i => (
          active ? (
            <motion.div
              key={i}
              style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: `1px solid ${color}`,
              }}
              animate={{ scale: [1, 1.7 + i * 0.3], opacity: [0.65, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
            />
          ) : null
        ))}

        {/* Log highlight shimmer */}
        {logHighlight && !active && (
          <motion.div
            style={{
              position: 'absolute', inset: -4, borderRadius: '50%',
              border: `1px dashed ${color}`,
            }}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.1, repeat: Infinity }}
          />
        )}

        {/* Burst */}
        <Burst color={color} go={burst} />

        {/* Rotating border ring */}
        <motion.div
          style={{
            position: 'absolute', inset: -5, borderRadius: '50%',
            border: `2px ${retry ? 'dashed' : 'solid'} ${color}`,
            opacity: glowing ? 1 : done ? 0.5 : 0.2,
          }}
          animate={glowing || retry ? { rotate: 360 } : {}}
          transition={{ duration: retry ? 2.5 : 6, repeat: Infinity, ease: 'linear' }}
        />

        {/* Counter-spin accent ring */}
        {active && (
          <motion.div
            style={{
              position: 'absolute', inset: -12, borderRadius: '50%',
              borderTop: '1px solid transparent',
              borderLeft: '1px solid transparent',
              borderBottom: `1px solid ${color}44`,
              borderRight: `1px solid ${color}44`,
            }}
            animate={{ rotate: -360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
          />
        )}

        {/* Glow halo */}
        <div style={{
          position: 'absolute', inset: -6, borderRadius: '50%',
          background: `radial-gradient(circle, ${color}28 0%, transparent 70%)`,
          filter: 'blur(7px)',
          opacity: glowing ? 1 : done ? 0.6 : 0.2,
          transition: 'opacity 0.4s',
        }} />

        {/* Core */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: `
            radial-gradient(circle at 34% 28%, rgba(255,255,255,0.11), transparent 38%),
            radial-gradient(circle, #060f1e, #020810)
          `,
          border: `1.5px solid ${color}${glowing ? 'cc' : done ? '88' : '44'}`,
          boxShadow: active
            ? `0 0 20px ${color}45, 0 0 40px ${color}18, inset 0 0 12px ${color}14`
            : failed
            ? `0 0 16px ${C.red}36, inset 0 0 10px ${C.red}14`
            : done
            ? `0 0 14px ${color}28`
            : logHighlight
            ? `0 0 12px ${color}30`
            : 'none',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 3,
          transition: 'box-shadow 0.4s, border-color 0.4s',
        }}>
          <motion.div
            style={{ fontSize: Math.max(13, SIZE * 0.22), lineHeight: 1 }}
            animate={active ? { scale: [1, 1.18, 1] } : {}}
            transition={{ duration: 1.7, repeat: Infinity }}
          >
            {meta.icon}
          </motion.div>
          <div style={{
            fontSize: Math.max(7, SIZE * 0.1), fontWeight: 900, letterSpacing: '0.04em',
            color: active ? '#fff' : done ? C.green : failed ? C.red : '#8ab0c8',
            textAlign: 'center',
            transition: 'color 0.4s',
          }}>
            {meta.short}
          </div>
        </div>
      </motion.div>

      {/* Label below */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#d0e8f8', letterSpacing: '0.01em' }}>
          {meta.label}
        </div>
        <motion.div
          style={{ fontSize: 7, letterSpacing: '0.14em', textTransform: 'uppercase', color, marginTop: 1 }}
          animate={active ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
          transition={{ duration: 1.1, repeat: active ? Infinity : 0 }}
        >
          {(status || 'pending').replace(/_/g, ' ')}
        </motion.div>
        {/* Latency pill */}
        {(active || done) && (
          <div style={{
            marginTop: 3, display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 6px', borderRadius: 999,
            background: `${color}14`, border: `1px solid ${color}30`,
            fontSize: 7, letterSpacing: '0.07em', color,
          }}>
            <span style={{ opacity: 0.55, color: '#6a90a8', textTransform: 'uppercase' }}>lat</span>
            <span>{latency}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SVG edge layer ───────────────────────────────────────────────────────────
function Edges({
  width, height, activeEdges,
}: {
  width: number; height: number; activeEdges: Set<string>
}) {
  function pos(key: string) {
    const n = NODES[key]
    const y = NODE_Y[key]
    return { x: (n.x / 100) * width, y: (y / 100) * height }
  }

  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <filter id="eg">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {EDGES.map((edge, i) => {
        const fr = pos(edge.from), to = pos(edge.to)
        const cpx = (fr.x + to.x) / 2
        const cpy = (fr.y + to.y) / 2 + (edge.to === 'deploy_service' && edge.from === 'allocate_compute' ? 12 : -12)
        const d = `M${fr.x},${fr.y} Q${cpx},${cpy} ${to.x},${to.y}`
        const on = activeEdges.has(`${edge.from}-${edge.to}`)

        return (
          <g key={i}>
            {/* Static dim track */}
            <path d={d} fill="none" stroke={edge.color} strokeWidth="1.2"
              strokeLinecap="round" opacity={on ? 0.3 : 0.08} />

            {/* Animated dashes */}
            {on && (
              <motion.path
                d={d} fill="none" stroke={edge.color} strokeWidth="2"
                strokeLinecap="round" strokeDasharray="8 16"
                filter="url(#eg)"
                animate={{ strokeDashoffset: [0, -96] }}
                transition={{ duration: edge.speed, repeat: Infinity, ease: 'linear' }}
                opacity={0.9}
              />
            )}

            {/* Photon dot */}
            {on && (
              <motion.circle r="3.5" fill={edge.color} filter="url(#eg)">
                <animateMotion
                  dur={`${edge.speed * 1.05}s`}
                  begin={`${edge.delay}s`}
                  repeatCount="indefinite"
                  path={d}
                  keyPoints="0;1" keyTimes="0;1" calcMode="linear"
                />
                <animate attributeName="opacity" values="0;1;1;0"
                  keyTimes="0;0.08;0.88;1"
                  dur={`${edge.speed * 1.05}s`}
                  begin={`${edge.delay}s`}
                  repeatCount="indefinite" />
              </motion.circle>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── Log ticker ───────────────────────────────────────────────────────────────
function LogTicker({ msg }: { msg: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={msg}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.28 }}
        style={{
          fontFamily: 'monospace', fontSize: 11, color: '#4a7090',
          letterSpacing: '0.04em', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}
      >
        <span style={{ color: C.teal, marginRight: 6 }}>›</span>{msg}
      </motion.div>
    </AnimatePresence>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export interface ExecutionGraphProps {
  task?: {
    task_id?: string; ticket?: string; status?: string
    steps?: Array<{
      tool: string; step_id?: string | number; status?: string
      retries?: number; depends_on?: string[]; duration_ms?: number
    }>
    cost_preview?: { total_hourly?: string | number; total_monthly?: string | number }
  } | null
  logs?: Array<{ message?: string; level?: string; ts?: string; id?: string }>
}

export default function ExecutionGraph({ task, logs = [] }: ExecutionGraphProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(900)
  const [canvasH] = useState(200)

  useEffect(() => {
    if (!canvasRef.current) return
    const obs = new ResizeObserver(([e]) => setCanvasW(e.contentRect.width))
    obs.observe(canvasRef.current)
    setCanvasW(canvasRef.current.offsetWidth)
    return () => obs.disconnect()
  }, [])

  const taskStatus = task?.status || 'pending'
  const steps      = task?.steps || []
  const running    = isRunning(taskStatus)
  const done       = isDone(taskStatus)
  const failed     = isFailed(taskStatus)
  const tick       = useTick(running)

  // Build stepMap
  const stepMap = useMemo(() =>
    Object.fromEntries(steps.map(s => [s.tool, s])), [steps])

  // Active tool from step states
  const activeTool = useMemo(() => {
    const inf = steps.find(s => isRunning(s.status))
    if (inf) return inf.tool
    if (done) return 'verify'
    if (failed) return steps.find(s => isFailed(s.status))?.tool || null
    return null
  }, [steps, done, failed])

  // Derive which node is highlighted by the latest log
  const logHighlightNode = useMemo(() => {
    const last = logs[logs.length - 1]
    if (!last?.message) return null
    for (const [re, node] of LOG_TO_NODE) {
      if (re.test(last.message)) return node
    }
    return null
  }, [logs])

  // Progress
  const progress = steps.length
    ? Math.round(steps.filter(s => isDone(s.status)).length / steps.length * 100)
    : done ? 100 : 0

  const totalRetries = steps.reduce((s, x) => s + (Number(x.retries) || 0), 0)

  // Active edges
  const activeEdges = useMemo(() => {
    const set = new Set<string>()
    if (!running && !done) return set
    const doneTools = new Set(steps.filter(s => isDone(s.status)).map(s => s.tool))
    set.add('master-create_storage')
    set.add('master-allocate_compute')
    if (doneTools.has('create_storage') || activeTool === 'deploy_service' || done)
      set.add('create_storage-deploy_service')
    if (doneTools.has('allocate_compute') || activeTool === 'deploy_service' || done)
      set.add('allocate_compute-deploy_service')
    if (doneTools.has('deploy_service') || done)
      set.add('deploy_service-verify')
    return set
  }, [steps, activeTool, running, done])

  // Node statuses
  const nodeStatuses: Record<string, string | undefined> = {
    master:           running ? 'executing' : done ? 'completed' : failed ? 'failed' : taskStatus,
    create_storage:   stepMap.create_storage?.status,
    allocate_compute: stepMap.allocate_compute?.status,
    deploy_service:   stepMap.deploy_service?.status,
    verify:           done ? 'verified' : stepMap.verify?.status,
  }

  const phase = taskStatus === 'planning' ? 'THINKING'
    : running ? 'EXECUTING'
    : done    ? 'VERIFIED'
    : failed  ? 'FAILED'
    : 'IDLE'

  const phaseColor = done ? C.green : failed ? C.red : running ? C.cyan : C.muted
  const latestMsg  = logs[logs.length - 1]?.message || (task ? 'Awaiting execution events…' : 'Deploy a service to activate')

  const liveLat = (nodeKey: string) => {
    const s = stepMap[nodeKey]
    if (s?.duration_ms) return `${Math.round(s.duration_ms)}ms`
    if (isDone(nodeStatuses[nodeKey])) return 'done'
    if (isRunning(nodeStatuses[nodeKey])) return `${28 + (tick % 37)}ms`
    return '–'
  }

  const nodeSize = canvasW < 420 ? 60 : canvasW < 560 ? 68 : 78

  // Canvas node absolute positions (using % x + fixed y in % of 200px)
  const nodePositions: Record<string, { left: string; top: string }> = {}
  Object.entries(NODES).forEach(([key, meta]) => {
    const y = NODE_Y[key]
    nodePositions[key] = {
      left: `${meta.x}%`,
      top:  `${y}%`,
    }
  })

  return (
    <div style={{
      borderRadius: 16,
      border: '1px solid rgba(64,224,255,0.13)',
      background: `
        radial-gradient(circle at 12% 50%, rgba(0,200,232,0.1), transparent 28%),
        radial-gradient(circle at 88% 50%, rgba(179,136,255,0.09), transparent 28%),
        linear-gradient(180deg, rgba(4,11,22,0.97), rgba(2,7,14,0.99))
      `,
      boxShadow: '0 12px 48px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.02)',
      overflow: 'hidden',
    }}>

      {/* ── Header bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#2d4a5e' }}>
            Neural Execution Graph
          </div>
          {/* Live phase chip */}
          <motion.div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 999,
              fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: phaseColor, border: `1px solid ${phaseColor}44`,
              background: `${phaseColor}10`,
            }}
            animate={running ? { boxShadow: [`0 0 8px ${phaseColor}30`, `0 0 18px ${phaseColor}60`, `0 0 8px ${phaseColor}30`] } : {}}
            transition={{ duration: 1.4, repeat: Infinity }}
          >
            {running && (
              <motion.div
                style={{ width: 5, height: 5, borderRadius: '50%', background: phaseColor }}
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              />
            )}
            {phase}
          </motion.div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Log ticker synced to latest log */}
          <LogTicker msg={latestMsg} />

          {/* Stats */}
          {[
            { l: 'progress', v: `${progress}%` },
            { l: 'retries',  v: `↺ ${totalRetries}` },
          ].map(({ l, v }) => (
            <div key={l} style={{
              fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em',
              color: '#2d4a5e', display: 'flex', gap: 5,
            }}>
              <span style={{ textTransform: 'uppercase' }}>{l}</span>
              <span style={{ color: C.teal }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={canvasRef}
        style={{
          position: 'relative',
          height: 320,
          overflow: 'hidden',
        }}
      >
        {/* Subtle animated grid */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(rgba(0,200,232,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,200,232,0.04) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0.8), transparent 85%)',
        }} />

        {/* Ambient glow blobs */}
        <motion.div style={{
          position: 'absolute', width: 240, height: 240, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,200,232,0.1), transparent 70%)',
          filter: 'blur(40px)', left: -60, top: -40, pointerEvents: 'none',
        }}
          animate={{ x: [0, 16, 0], y: [0, 10, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div style={{
          position: 'absolute', width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(179,136,255,0.08), transparent 70%)',
          filter: 'blur(36px)', right: -40, top: -20, pointerEvents: 'none',
        }}
          animate={{ x: [0, -12, 0], y: [0, 8, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />

        {/* SVG edges */}
        <Edges width={canvasW} height={320} activeEdges={activeEdges} />

        {/* Nodes — absolutely positioned */}
        {Object.keys(NODES).map(key => (
          <div
            key={key}
            style={{
              position: 'absolute',
              left: nodePositions[key].left,
              top: nodePositions[key].top,
              transform: 'translate(-50%, -50%)',
              zIndex: 5,
            }}
          >
            <Node
              nodeKey={key}
              status={nodeStatuses[key]}
              active={key === 'master' ? running : activeTool === key}
              logHighlight={logHighlightNode === key}
              tick={tick}
              latency={liveLat(key)}
              size={nodeSize}
            />
          </div>
        ))}

        {/* Progress bar at bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 2, background: 'rgba(255,255,255,0.04)',
        }}>
          <motion.div
            style={{
              height: '100%',
              background: `linear-gradient(90deg, ${C.teal}, ${C.cyan}, ${C.green})`,
              boxShadow: `0 0 8px ${C.cyan}80`,
            }}
            animate={{ width: `${Math.max(2, progress)}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>
    </div>
  )
}
