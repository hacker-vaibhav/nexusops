// pages/Costs.jsx
import { PRICING, estimateCost, getCatalogItem, getEndpoint, msToS, STATUS_COLOR } from '../shared/store'
import { SectionHeader, StatCard, EmptyState, Page } from '../components/UI'

const C = { teal:'#00c8e8', green:'#00e676', amber:'#ffab40', red:'#ff5252', purple:'#b388ff' }

function CostBar({ value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ flex:1, height:6, background:'var(--border)',
      borderRadius:3, overflow:'hidden' }}>
      <div style={{
        height:'100%', width:`${pct}%`,
        background:`linear-gradient(90deg, ${color}80, ${color})`,
        borderRadius:3, transition:'width 0.6s ease',
        boxShadow:`0 0 6px ${color}50`
      }}/>
    </div>
  )
}

function ResourceTable({ tasks }) {
  const rows = tasks.flatMap(t => {
    const cat = getCatalogItem(t)
    const res = t.final_report?.resources || []
    return res.map(r => ({ ...r, task_id:t.task_id, cat, status:t.status }))
  })

  if (!rows.length) return (
    <div style={{ color:'var(--text-muted)', fontFamily:'var(--font-mono)',
      fontSize:11, padding:'24px', textAlign:'center' }}>
      No resources provisioned yet
    </div>
  )

  const typeIcon = t => t === 'S3 Bucket' ? '🗄' : t === 'EC2 Instance' ? '⚙️' : '🚀'

  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse',
        fontFamily:'var(--font-mono)', fontSize:11 }}>
        <thead>
          <tr style={{ borderBottom:'1px solid var(--border)' }}>
            {['Type','Name / ID','Service','Region','Status','Cost/mo'].map(h => (
              <th key={h} style={{ padding:'8px 12px', textAlign:'left',
                color:'var(--text-muted)', fontWeight:600,
                letterSpacing:'0.07em', fontSize:10 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r,i) => (
            <tr key={i} style={{
              borderBottom:'1px solid rgba(26,48,80,0.5)',
              transition:'background 0.15s'
            }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(0,200,232,0.03)'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}
            >
              <td style={{ padding:'10px 12px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:15 }}>{typeIcon(r.type)}</span>
                  <span style={{ color:'var(--text-primary)' }}>{r.type}</span>
                </div>
              </td>
              <td style={{ padding:'10px 12px', color:C.cyan }}>
                {r.name || r.id || r.endpoint || '—'}
              </td>
              <td style={{ padding:'10px 12px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:13 }}>{r.cat?.icon || '⚙️'}</span>
                  <span style={{ color:'var(--text-secondary)' }}>
                    {r.cat?.name || r.task_id}
                  </span>
                </div>
              </td>
              <td style={{ padding:'10px 12px', color:'var(--text-secondary)' }}>
                us-east-1
              </td>
              <td style={{ padding:'10px 12px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ width:5, height:5, borderRadius:'50%',
                    background: C.green,
                    boxShadow:`0 0 5px ${C.green}` }}/>
                  <span style={{ color:C.green }}>active</span>
                </div>
              </td>
              <td style={{ padding:'10px 12px', color:C.amber, fontWeight:600 }}>
                {r.type === 'S3 Bucket' ? '$0.02'
                  : r.type === 'EC2 Instance' ? `$${(0.0464*730).toFixed(2)}`
                  : '$0.00'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Costs({ tasks }) {
  const live = tasks.filter(t => t.status === 'completed')

  if (live.length === 0) {
    return (
      <Page>
        <EmptyState icon="💰" title="No cost data yet"
          body="Deploy services to see a real-time cost breakdown and resource inventory."/>
      </Page>
    )
  }

  const costData = live.map(t => {
    const cat  = getCatalogItem(t)
    const cost = estimateCost(t)
    const res  = t.final_report?.resources || []
    return { task:t, cat, cost, resources:res.length }
  })

  const totalMonthly = costData.reduce((s,d) => s + d.cost.monthly, 0)
  const maxCost = Math.max(...costData.map(d => d.cost.monthly))

  // Instance type breakdown
  const instanceTypes = {}
  live.forEach(t => {
    const c = t.steps?.find(s => s.tool === 'allocate_compute')
    const type = c?.output?.instance_type || 't2.medium'
    instanceTypes[type] = (instanceTypes[type] || 0) + 1
  })

  return (
    <Page>
      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)',
        gap:14, marginBottom:28 }}>
        <StatCard icon="💰" label="MONTHLY ESTIMATE"  value={`$${totalMonthly.toFixed(2)}`} color={C.amber} delay={0}/>
        <StatCard icon="⚙️" label="EC2 INSTANCES"     value={live.length}                    color={C.teal}  delay={0.06}/>
        <StatCard icon="🗄" label="S3 BUCKETS"        value={live.length}                    color={C.purple}delay={0.12}/>
        <StatCard icon="🚀" label="RUNNING SERVICES"  value={live.length}                    color={C.green} delay={0.18}/>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:20, marginBottom:28 }}>
        {/* Per-service cost breakdown */}
        <div>
          <SectionHeader title="COST BY SERVICE" color={C.amber}/>
          <div className="panel" style={{ padding:'18px 20px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {costData.map((d,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:14 }}>
                  <div style={{
                    width:34, height:34, borderRadius:9, flexShrink:0,
                    background:`${d.cat?.color || C.teal}15`,
                    border:`1px solid ${d.cat?.color || C.teal}30`,
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:17
                  }}>{d.cat?.icon || '⚙️'}</div>

                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center',
                      justifyContent:'space-between', marginBottom:6 }}>
                      <span style={{ fontFamily:'var(--font-display)', fontWeight:700,
                        fontSize:12, color:'var(--text-primary)' }}>
                        {d.task.final_report?.service_name || d.cat?.name || 'Service'}
                      </span>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <span style={{ fontSize:10, color:'var(--text-muted)',
                          fontFamily:'var(--font-mono)' }}>
                          ${(d.cost.monthly/totalMonthly*100).toFixed(0)}% of total
                        </span>
                        <span style={{ fontFamily:'var(--font-display)', fontWeight:800,
                          fontSize:14, color:C.amber }}>
                          ${d.cost.monthly}/mo
                        </span>
                      </div>
                    </div>
                    <CostBar value={d.cost.monthly} max={maxCost} color={d.cat?.color || C.teal}/>
                    <div style={{ display:'flex', gap:16, marginTop:5,
                      fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text-muted)' }}>
                      <span>EC2: ${(d.cost.hourly*730).toFixed(2)}/mo</span>
                      <span>S3: $0.02/mo</span>
                      <span>Env: {d.task.final_report?.environment || '—'}</span>
                    </div>
                  </div>
                </div>
              ))}

              {/* Total */}
              <div style={{
                borderTop:'1px solid var(--border)', paddingTop:14,
                display:'flex', justifyContent:'space-between', alignItems:'center'
              }}>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:11,
                  color:'var(--text-muted)', letterSpacing:'0.07em' }}>
                  TOTAL MONTHLY ESTIMATE
                </span>
                <span style={{ fontFamily:'var(--font-display)', fontWeight:800,
                  fontSize:22, color:C.amber }}>
                  ${totalMonthly.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Instance type breakdown + pricing table */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div>
            <SectionHeader title="INSTANCE TYPES" color={C.teal}/>
            <div className="panel" style={{ padding:'16px 18px' }}>
              {Object.entries(instanceTypes).map(([type, count]) => (
                <div key={type} style={{
                  display:'flex', alignItems:'center',
                  justifyContent:'space-between', padding:'8px 0',
                  borderBottom:'1px solid rgba(26,48,80,0.5)'
                }}>
                  <div>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize:12,
                      color:C.teal, marginBottom:2 }}>{type}</div>
                    <div style={{ fontSize:10, color:'var(--text-muted)',
                      fontFamily:'var(--font-mono)' }}>
                      ${PRICING[type]?.toFixed(4) || '0.0464'}/hr
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontFamily:'var(--font-display)', fontWeight:700,
                      fontSize:16, color:'var(--text-primary)' }}>{count}×</div>
                    <div style={{ fontSize:10, color:C.amber,
                      fontFamily:'var(--font-mono)' }}>
                      ${((PRICING[type] || 0.0464)*730*count).toFixed(2)}/mo
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing reference */}
          <div>
            <SectionHeader title="AWS PRICING REF" color={C.purple}/>
            <div className="panel" style={{ padding:'14px 16px' }}>
              {Object.entries(PRICING).slice(0,6).map(([type, price]) => (
                <div key={type} style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'6px 0',
                  borderBottom:'1px solid rgba(26,48,80,0.4)',
                  fontFamily:'var(--font-mono)', fontSize:10
                }}>
                  <span style={{ color:'var(--text-secondary)' }}>{type}</span>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ color:C.teal }}>${price.toFixed(4)}/hr</div>
                    <div style={{ color:'var(--text-muted)' }}>${(price*730).toFixed(2)}/mo</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Resource inventory table */}
      <SectionHeader title="RESOURCE INVENTORY" color={C.green}
        count={live.reduce((s,t) => s + (t.final_report?.resources?.length || 0), 0)}/>
      <div className="panel" style={{ overflow:'hidden' }}>
        <ResourceTable tasks={live}/>
      </div>
    </Page>
  )
}
