// pages/Dashboard.jsx
import { StatCard, SectionHeader, HealthDot, Sparkline, StatusBadge, EmptyState, Page } from '../components/UI'
import { estimateCost, getEndpoint, getCatalogItem, getInstanceId, msToS, timeAgo, STATUS_COLOR } from '../shared/store'

const C = { teal:'#00c8e8', green:'#00e676', amber:'#ffab40', red:'#ff5252', purple:'#b388ff' }

function ServiceRow({ task, onViewLogs, onTest }) {
  const cat   = getCatalogItem(task)
  const ep    = getEndpoint(task)
  const cost  = estimateCost(task)
  const color = cat?.color || C.teal
  const isLive = task.status === 'completed'

  return (
    <div className="panel-card anim-fadeUp" style={{
      padding:'14px 18px',
      borderColor: isLive ? `${color}35` : 'var(--border)',
      display:'grid',
      gridTemplateColumns:'40px 1fr 160px 120px 100px 90px 140px',
      alignItems:'center', gap:16,
      transition:'border-color 0.2s'
    }}>
      {/* Icon */}
      <div style={{
        width:36, height:36, borderRadius:9,
        background:`${color}15`, border:`1px solid ${color}30`,
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:18
      }}>{cat?.icon || '⚙️'}</div>

      {/* Name + env */}
      <div>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:700,
          fontSize:13, color:'var(--text-primary)', marginBottom:2 }}>
          {task.final_report?.service_name || cat?.name || 'Service'}
        </div>
        <div style={{ fontSize:10, fontFamily:'var(--font-mono)',
          color:'var(--text-muted)', textTransform:'uppercase' }}>
          {task.final_report?.environment || cat?.env || 'unknown'}
        </div>
      </div>

      {/* Health */}
      <HealthDot active={isLive} showLatency />

      {/* Status badge */}
      <StatusBadge status={task.status} />

      {/* Deploy time */}
      <div>
        <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:C.teal }}>
          {msToS(task.total_duration_ms)}
        </div>
        <div style={{ fontSize:9, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>
          deploy time
        </div>
      </div>

      {/* Cost */}
      <div>
        <div style={{ fontSize:12, fontFamily:'var(--font-display)',
          fontWeight:700, color:C.amber }}>
          ${cost.monthly}/mo
        </div>
        <div style={{ fontSize:9, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>
          est. cost
        </div>
      </div>

      {/* Actions */}
      <div style={{ display:'flex', gap:6 }}>
        <button onClick={() => onViewLogs(task)} style={{
          fontSize:10, padding:'4px 10px', borderRadius:6, cursor:'pointer',
          background:'rgba(0,200,232,0.06)', border:'1px solid var(--border)',
          color:'var(--text-secondary)', fontFamily:'var(--font-mono)'
        }}>Logs</button>
        {isLive && ep && (
          <button onClick={() => onTest(task, ep)} style={{
            fontSize:10, padding:'4px 10px', borderRadius:6, cursor:'pointer',
            background:'rgba(0,230,118,0.08)', border:'1px solid rgba(0,230,118,0.25)',
            color:C.green, fontFamily:'var(--font-mono)'
          }}>▶ Test</button>
        )}
      </div>
    </div>
  )
}

function RecentActivity({ tasks }) {
  const events = tasks
    .flatMap(t => (t.steps || []).map(s => ({
      task_id: t.task_id,
      tool: s.tool,
      status: s.status,
      ts: s.completed_at || s.started_at || t.created_at,
      cat: getCatalogItem(t),
    })))
    .filter(e => e.ts)
    .sort((a,b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 8)

  if (!events.length) return null

  const toolLabel = t => t === 'create_storage' ? '🗄 Storage Agent'
    : t === 'allocate_compute' ? '⚙️ Compute Agent'
    : '🚀 Deploy Agent'

  return (
    <div>
      <SectionHeader title="RECENT ACTIVITY" color={C.purple}/>
      <div className="panel" style={{ overflow:'hidden' }}>
        {events.map((e,i) => {
          const col = STATUS_COLOR(e.status)
          return (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:14,
              padding:'10px 16px',
              borderBottom: i < events.length-1 ? '1px solid var(--border)' : 'none'
            }}>
              <div style={{ width:6, height:6, borderRadius:'50%',
                background:col, flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <span style={{ fontSize:12, color:'var(--text-primary)' }}>
                  {toolLabel(e.tool)}
                </span>
                <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:8 }}>
                  on {e.cat?.name || e.task_id}
                </span>
              </div>
              <StatusBadge status={e.status}/>
              <span style={{ fontSize:10, color:'var(--text-muted)',
                fontFamily:'var(--font-mono)', flexShrink:0 }}>
                {timeAgo(e.ts)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LatestDeployments({ tasks, onNavigate }) {
  const latest = [...tasks]
    .filter(t => t.status === 'completed')
    .sort((a, b) => new Date(b.created_at || b.final_report?.completed_at || 0) - new Date(a.created_at || a.final_report?.completed_at || 0))
    .slice(0, 5)

  if (!latest.length) {
    return (
      <EmptyState
        icon="⎈"
        title="No successful deployments yet"
        body="Completed services will appear here with their real AWS URL and instance id."
      />
    )
  }

  return (
    <div style={{ display:'grid', gap:8 }}>
      {latest.map(task => {
        const url = getEndpoint(task)
        const instanceId = getInstanceId(task)
        const svc = task.final_report?.service_name || getCatalogItem(task)?.name || task.task_id
        return (
          <a
            key={task.task_id}
            href={url || '#'}
            target="_blank"
            rel="noreferrer"
            className="panel-card"
            style={{
              display:'grid',
              gridTemplateColumns:'1.1fr 1.4fr 1fr auto',
              gap:12,
              alignItems:'center',
              textDecoration:'none',
              padding:'14px 16px',
            }}
          >
            <div>
              <div style={{ fontFamily:'var(--font-display)', fontWeight:800, color:'var(--text-primary)' }}>
                {svc}
              </div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)' }}>
                {task.final_report?.environment || 'unknown'}
              </div>
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', letterSpacing:'0.12em', textTransform:'uppercase' }}>
                Public URL
              </div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:C.teal, wordBreak:'break-all' }}>
                {url || 'n/a'}
              </div>
            </div>
            <div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', letterSpacing:'0.12em', textTransform:'uppercase' }}>
                Instance ID
              </div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:C.green }}>
                {instanceId || 'n/a'}
              </div>
            </div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)' }}>
              {timeAgo(task.final_report?.completed_at || task.created_at)}
            </div>
          </a>
        )
      })}
    </div>
  )
}

export default function Dashboard({ tasks, onViewLogs, onTest, onNavigate, systemMode }) {
  const live    = tasks.filter(t => t.status === 'completed')
  const running = tasks.filter(t => ['planning','executing','running','pending'].includes(t.status))
  const failed  = tasks.filter(t => t.status === 'failed')
  const totalCost = live.reduce((s,t) => s + estimateCost(t).monthly, 0)
  const avgDeploy = live.filter(t => t.total_duration_ms)
    .reduce((a,t,_,arr) => a + t.total_duration_ms/arr.length, 0)

  return (
    <Page>
      {systemMode !== 'real' && (
        <div className="panel" style={{
          marginBottom:18,
          borderColor:'rgba(255,190,70,0.25)',
          background:'linear-gradient(135deg, rgba(255,190,70,0.10), rgba(0,0,0,0.18))',
        }}>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:800, color:C.amber, marginBottom:4 }}>
            {systemMode === 'offline' ? 'OFFLINE' : 'ONLINE / MOCK MODE'}
          </div>
          <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
            {systemMode === 'offline'
              ? 'The backend is not reachable right now.'
              : 'The backend is online, but AI provider keys are missing or AWS is not in real mode, so the dashboard is showing the safe mock view.'}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:28 }}>
        <StatCard icon="✅" label="SERVICES LIVE"      value={live.length}        color={C.green}  delay={0} />
        <StatCard icon="⏳" label="DEPLOYING"          value={running.length}     color={C.teal}   delay={0.06} />
        <StatCard icon="💰" label="EST. MONTHLY COST"  value={`$${totalCost.toFixed(2)}`} color={C.amber} delay={0.12} />
        <StatCard icon="⚡" label="AVG DEPLOY TIME"    value={msToS(Math.round(avgDeploy))} color={C.purple} delay={0.18} />
      </div>

      {/* Running services */}
      {running.length > 0 && (
        <div style={{ marginBottom:28 }}>
          <SectionHeader title="DEPLOYING NOW" color={C.teal} count={running.length}
            right={
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background:C.teal,
                  boxShadow:`0 0 6px ${C.teal}`, animation:'blink 0.8s ease infinite' }}/>
                <span style={{ fontSize:10, color:C.teal, fontFamily:'var(--font-mono)' }}>LIVE</span>
              </div>
            }
          />
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {running.map(t => <ServiceRow key={t.task_id} task={t} onViewLogs={onViewLogs} onTest={onTest}/>)}
          </div>
        </div>
      )}

      {/* Live services */}
      <div style={{ marginBottom:28 }}>
        <SectionHeader title="LIVE SERVICES" color={C.green} count={live.length}
          right={
            <button onClick={() => onNavigate('deploy')} style={{
              fontSize:11, padding:'5px 14px', borderRadius:7, cursor:'pointer',
              background:'linear-gradient(135deg,#005a70,#00c8e8)',
              border:'none', color:'white',
              fontFamily:'var(--font-display)', fontWeight:700
            }}>+ Deploy New</button>
          }
        />
        {live.length === 0 ? (
          <EmptyState icon="🚀" title="No live services yet"
            body="Deploy your first service to see it here."
            action={
              <button onClick={() => onNavigate('deploy')} style={{
                padding:'10px 24px', borderRadius:9, cursor:'pointer',
                background:'linear-gradient(135deg,#005a70,#00c8e8)',
                border:'none', color:'white',
                fontFamily:'var(--font-display)', fontWeight:700, fontSize:13
              }}>Go to Deploy →</button>
            }
          />
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {live.map(t => <ServiceRow key={t.task_id} task={t} onViewLogs={onViewLogs} onTest={onTest}/>)}
          </div>
        )}
      </div>

      {/* Failed */}
      {failed.length > 0 && (
        <div style={{ marginBottom:28 }}>
          <SectionHeader title="FAILED" color={C.red} count={failed.length}/>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {failed.map(t => <ServiceRow key={t.task_id} task={t} onViewLogs={onViewLogs} onTest={onTest}/>)}
          </div>
        </div>
      )}

      <div style={{ marginBottom:28 }}>
        <SectionHeader title="LATEST DEPLOYMENTS" color={C.purple} count={tasks.filter(t => t.status === 'completed').length} />
        <LatestDeployments tasks={tasks} onNavigate={onNavigate} />
      </div>

      {/* Recent activity */}
      <RecentActivity tasks={tasks}/>
    </Page>
  )
}
