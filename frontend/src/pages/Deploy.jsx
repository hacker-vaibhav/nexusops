import { useCallback, useEffect, useState } from 'react'
import { Bot, CircleAlert, Coins, Flame, Lock, Server, Workflow, Zap } from 'lucide-react'
import { CATALOG, STATUS_COLOR, getCatalogItem } from '../shared/store'
import { LogStream, Page, SectionHeader } from '../components/UI'
import ExecutionGraph from '../components/ExecutionGraph'
import { previewCost, validateTicket } from '../utils/api'

const C = {
  teal:'#00d9ff',
  green:'#00f38d',
  amber:'#ffbe46',
  red:'#ff4d6d',
  purple:'#b67dff',
  blue:'#57b6ff',
}

const ENV_STYLES = {
  production: { label:'PRODUCTION', color:C.green },
  staging: { label:'STAGING', color:C.amber },
  development: { label:'DEVELOPMENT', color:C.purple },
}

function useValidation(text) {
  const [result, setResult] = useState(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async (t) => {
    if (!t || !t.trim()) {
      setResult(null)
      return null
    }
    setChecking(true)
    try {
      const next = await validateTicket(t)
      setResult(next)
      return next
    } catch {
      setResult(null)
      return null
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => check(text), 500)
    return () => clearTimeout(t)
  }, [text, check])

  return { result, checking, validateNow: check }
}

function ValidationBadge({ result, checking }) {
  if (checking) {
    return (
      <div className="validation-strip">
        <div className="mini-spinner" />
        <span>Analysing ticket...</span>
      </div>
    )
  }

  if (!result) return null

  const cfg = {
    VALID: { icon:'VALIDATED', color:C.green, className:'is-valid' },
    INVALID: { icon:'BLOCKED', color:C.red, className:'is-invalid' },
    INCOMPLETE: { icon:'INCOMPLETE', color:C.amber, className:'is-warn' },
  }[result.status]

  return (
    <div className={`validation-panel ${cfg.className}`}>
      <div className="validation-title-row">
        <span className="validation-title">{cfg.icon}</span>
        {result.confidence > 0 && result.status === 'VALID' && (
          <span className="validation-meta">{Math.round(result.confidence * 100)}% confidence</span>
        )}
      </div>
      {result.error && <div className="validation-copy">{result.error}</div>}
      {result.suggestion && <div className="validation-suggestion">{result.suggestion}</div>}
      {result.extracted && Object.keys(result.extracted).length > 0 && (
        <div className="validation-tags">
          {Object.entries(result.extracted).map(([k, v]) => (
            <span key={k} className="validation-tag">{k}: {v}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function CostPreviewModal({ open, data, onConfirm, onCancel, loading }) {
  if (!open) return null
  const cost = data?.cost_estimate
  const preview = data?.task_preview

  return (
    <div className="modal-shell">
      <div className="panel anim-scaleIn" style={{ width:540, padding:28 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <Coins size={18} color={C.amber} />
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:17 }}>Cost Preview</div>
        </div>
        <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:20 }}>
          Review estimated infrastructure cost before execution.
        </p>

        {loading ? (
          <div className="terminal-block" style={{ display:'flex', alignItems:'center', gap:10, color:C.teal }}>
            <div className="mini-spinner" />
            Generating estimate...
          </div>
        ) : cost ? (
          <>
            {preview && (
              <div className="terminal-block" style={{ marginBottom:14 }}>
                <div className="execution-meta-grid">
                  <span>service</span><strong>{preview.service_name}</strong>
                  <span>env</span><strong>{preview.environment}</strong>
                  <span>steps</span><strong>{preview.steps}</strong>
                </div>
              </div>
            )}

            <div style={{ display:'grid', gap:8, marginBottom:16 }}>
              {cost.breakdown.map((row, index) => (
                <div key={index} className="cost-line-item">
                  <div>
                    <div className="cost-line-title">{row.resource}</div>
                    <div className="cost-line-note">{row.note}</div>
                  </div>
                  <div className="cost-line-value">${row.monthly.toFixed(2)}/mo</div>
                </div>
              ))}
            </div>

            <div className="cost-summary-box">
              <span>ESTIMATED TOTAL</span>
              <div>
                <div className="cost-summary-main">${cost.total_monthly}/month</div>
                <div className="cost-summary-sub">${cost.total_hourly}/hr</div>
              </div>
            </div>

            <p style={{ fontSize:10, color:'var(--text-muted)', marginTop:14 }}>{cost.note}</p>
          </>
        ) : null}

        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          <button onClick={onCancel} className="ghost-chip" style={{ flex:1, justifyContent:'center', padding:'11px 12px' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} className="primary-action" style={{ flex:2 }}>
            Execute Now
          </button>
        </div>
      </div>
    </div>
  )
}

function getServiceIcon(id) {
  if (id === 'payments') return Lock
  if (id === 'auth') return Lock
  if (id === 'ml') return Bot
  if (id === 'web') return Workflow
  if (id === 'data') return Server
  return Zap
}

function CatalogCard({ svc, deployed, onDeploy, busy, disabled }) {
  const envStyle = ENV_STYLES[svc.env] || { label:svc.env.toUpperCase(), color:C.teal }
  const Icon = getServiceIcon(svc.id)

  return (
    <div className={`catalog-card ${deployed ? 'is-deployed' : ''} ${busy ? 'is-busy' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <div className="catalog-card-corner" style={{ borderTopColor: `${envStyle.color}45`, borderLeftColor: 'transparent' }} />
      <div className="catalog-card-head">
        <div className="catalog-icon" style={{ color:svc.color }}>
          <Icon size={18} strokeWidth={1.8} />
        </div>
        <span className="catalog-env" style={{ color:envStyle.color, borderColor:`${envStyle.color}35`, backgroundColor:`${envStyle.color}14` }}>
          {envStyle.label}
        </span>
      </div>

      <div className="catalog-name">{svc.name}</div>
      <div className="catalog-desc">{svc.desc}</div>

      {svc.id === 'auth' && deployed && (
        <div className="catalog-live-line">
          <span className="live-dot" />
          <span>LIVE</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => !disabled && onDeploy(svc.ticket, 3, svc.id)}
        disabled={disabled || busy}
        className={`catalog-action ${deployed ? 'is-outline' : 'is-primary'}`}
      >
        <Flame size={11} strokeWidth={2} />
        <span>{busy ? 'DEPLOYING' : deployed ? 'REDEPLOY' : 'DEPLOY'}</span>
      </button>
    </div>
  )
}

function ExecutionEmpty() {
  return (
    <div className="execution-empty">
      <div className="execution-empty-ring">
        <Zap size={18} strokeWidth={2.2} />
      </div>
      <div className="execution-empty-title">LIVE EXECUTION</div>
      <div className="execution-empty-copy">
        Deploy a service to watch agents orchestrate your infrastructure in real-time.
      </div>
    </div>
  )
}

function ExecutionPanel({ task, logs, deployError }) {
  if (deployError) {
    return (
      <div className="validation-panel is-invalid" style={{ marginTop:0 }}>
        <div className="validation-title-row">
          <CircleAlert size={14} />
          <span className="validation-title">Request Blocked</span>
        </div>
        <div className="validation-copy">{deployError.reason}</div>
        {deployError.suggestion && <div className="validation-suggestion">{deployError.suggestion}</div>}
      </div>
    )
  }

  if (!task) return <ExecutionEmpty />

  const steps = task.steps || []
  const totalRetries = steps.reduce((sum, step) => sum + (step.retries || 0), 0)
  const infraGenome = task.infra_genome || task.final_report?.infra_genome
  const genomeMatch = task.infra_genome_match || task.final_report?.infra_genome_match

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, height:'100%', minHeight:0 }}>
      <div className="execution-summary">
        <div className="execution-summary-top">
          <span className="execution-task-id">{task.task_id}</span>
          <div className="execution-status-row">
            <div className={`dot dot-${task.status}`} />
            <span style={{ color:STATUS_COLOR(task.status), textTransform:'uppercase' }}>{task.status}</span>
          </div>
        </div>
        <p className="execution-summary-ticket">{task.ticket}</p>
        {task.cost_preview && (
          <div className="execution-inline-chip">Est. cost: ${task.cost_preview.total_monthly}/month</div>
        )}
        {infraGenome && (
          <div className="execution-genome-box">
            <div className="execution-genome-top">
              <span>InfraGenome captured</span>
              <strong>{Math.round((genomeMatch?.similarity ?? 1) * 100)}% match</strong>
            </div>
            <div className="execution-genome-title">{infraGenome.title}</div>
            <div className="execution-genome-copy">{infraGenome.semantic_description}</div>
          </div>
        )}
      </div>

      <div>
        <div className="section-kicker">
          Agent Steps
          {totalRetries > 0 && <span className="execution-inline-chip">Retries {totalRetries}</span>}
        </div>
        <div style={{ display:'grid', gap:8 }}>
          {steps.length === 0 ? (
            <div className="terminal-block">Generating plan...</div>
          ) : (
            steps.map((step) => {
              const col = STATUS_COLOR(step.status)
              const toolName = step.tool === 'create_storage'
                ? 'Storage Agent'
                : step.tool === 'allocate_compute'
                  ? 'Compute Agent'
                  : 'Deploy Agent'

              return (
                <div key={step.step_id} className="execution-step" style={{ borderColor:`${col}55` }}>
                  <div className="execution-step-main">
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ width:6, height:6, borderRadius:'50%', background:col, boxShadow:`0 0 8px ${col}` }} />
                      <span>{toolName}</span>
                    </div>
                    <span style={{ color:col, textTransform:'uppercase' }}>{step.status}</span>
                  </div>
                  {step.depends_on?.length > 0 && (
                    <div className="execution-step-sub">after [{step.depends_on.join(', ')}]</div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
        <div className="section-kicker">Agent Log</div>
        <LogStream logs={logs} height="100%" />
      </div>
    </div>
  )
}

export default function Deploy({ tasks, activeTask, activeLogs, deploying, deployingTargetId, onDeploy, deployError, systemMode }) {
  const [customTicket, setCustomTicket] = useState('')
  const [priority, setPriority] = useState(3)
  const { result: valResult, checking: valChecking, validateNow } = useValidation(customTicket)
  const [costModal, setCostModal] = useState({ open:false, data:null, loading:false, ticket:'', priority:3 })

  async function handleCostPreview(ticketText) {
    setCostModal({ open:true, data:null, loading:true, ticket:ticketText, priority })
    const data = await previewCost(ticketText)
    setCostModal(m => ({ ...m, data, loading:false }))
  }

  function handleConfirmDeploy() {
    const ticket = costModal.ticket
    const p = costModal.priority
    setCostModal({ open:false, data:null, loading:false, ticket:'', priority:3 })
    onDeploy(ticket, p, null)
  }

  async function handleCustomDeploy() {
    const ticket = customTicket.trim()
    const validation = await validateNow(ticket)
    if (!validation || validation.status !== 'VALID') return
    onDeploy(ticket, priority, null)
  }

  const inFlightStatuses = new Set(['pending', 'queued', 'planning', 'running', 'executing', 'retrying', 'cancelling'])
  const activeCatalogId = activeTask && inFlightStatuses.has(activeTask.status) ? getCatalogItem(activeTask)?.id || null : null
  const deployedIds = new Set(tasks.filter(t => t.status === 'completed').map(t => getCatalogItem(t)?.id).filter(Boolean))
  const runningIds = new Set(tasks.filter(t => inFlightStatuses.has(t.status)).map(t => getCatalogItem(t)?.id).filter(Boolean))

  const canPreview = customTicket.trim().length >= 6 && !deploying && valResult?.status === 'VALID'
  const customBlocked = customTicket.trim().length > 0 && valResult && valResult.status !== 'VALID'
  const showGraph = activeTask && ['pending', 'queued', 'planning', 'running', 'executing', 'retrying', 'completed', 'verified', 'failed'].includes(activeTask.status)

  return (
    <Page>
      {systemMode !== 'real' && (
        <div className="panel" style={{
          marginBottom:18,
          borderColor:'rgba(255,190,70,0.25)',
          background:'linear-gradient(135deg, rgba(255,190,70,0.10), rgba(0,0,0,0.18))',
        }}>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:800, color:C.amber, marginBottom:4 }}>
            {systemMode === 'offline' ? 'OFFLINE' : 'ONLINE / MOCK MODE ACTIVE'}
          </div>
          <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
            {systemMode === 'offline'
              ? 'The backend is not reachable right now.'
              : 'The backend is online, but the AI provider keys are missing or AWS is not in real mode, so deployments stay in mock mode and will not attempt real cloud changes.'}
          </div>
        </div>
      )}

      <CostPreviewModal
        open={costModal.open}
        data={costModal.data}
        loading={costModal.loading}
        onConfirm={handleConfirmDeploy}
        onCancel={() => setCostModal({ open:false, data:null, loading:false, ticket:'', priority:3 })}
      />

      <div className="deploy-layout">
        <div className="deploy-main">
          <SectionHeader
            title="SERVICE CATALOG"
            color={C.teal}
            right={<span className="section-note">ONE-CLICK DEPLOY WITH PRE-VALIDATED TICKETS</span>}
          />

          <div className="catalog-grid">
            {CATALOG.map((svc) => (
              <CatalogCard
                key={svc.id}
                svc={svc}
                deployed={deployedIds.has(svc.id)}
                busy={deployingTargetId === svc.id || activeCatalogId === svc.id || runningIds.has(svc.id)}
                disabled={deploying && deployingTargetId !== svc.id && activeCatalogId !== svc.id && !runningIds.has(svc.id)}
                onDeploy={onDeploy}
              />
            ))}
          </div>

          <div className="ticket-wrap">
            <SectionHeader
              title="CUSTOM TICKET"
              color={C.teal}
              right={<span className="section-note">Validated before execution. Contradictions blocked.</span>}
            />

            <div className="panel ticket-panel">
              <textarea
                value={customTicket}
                onChange={(e) => setCustomTicket(e.target.value)}
                disabled={deploying}
                rows={4}
                className="deploy-textarea"
                placeholder={'e.g. Set up a production environment for payments-api\nwith S3 bucket in us-east-1, t2.medium EC2 instance,\ndeploy payments-api:latest on port 8080'}
              />

              <ValidationBadge result={valResult} checking={valChecking} />

              <div className="ticket-actions-row">
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="priority-select"
                >
                  <option value={1}>P1 - Critical</option>
                  <option value={2}>P2 - High</option>
                  <option value={3}>P3 - Normal</option>
                  <option value={4}>P4 - Low</option>
                </select>

                <button type="button" className="primary-action" onClick={handleCustomDeploy} disabled={!canPreview}>
                  <Zap size={13} strokeWidth={2.4} />
                  <span>{deploying ? 'DEPLOYING...' : 'EXECUTE TICKET'}</span>
                </button>
              </div>

              <div className="ticket-secondary-row">
                <button type="button" className="ghost-chip" onClick={() => handleCostPreview(customTicket.trim())} disabled={!canPreview}>
                  <Coins size={13} />
                  Cost Preview
                </button>
                {customBlocked && (
                  <div className="ticket-hint" style={{ color:valResult.status === 'INVALID' ? C.red : C.amber }}>
                    {valResult.status === 'INVALID' ? `Invalid ticket: ${valResult.error}` : `Incomplete ticket: ${valResult.error}`}
                  </div>
                )}
              </div>
            </div>
          </div>

          {showGraph && (
            <div>
              <SectionHeader
                title="ADAPTIVE INTELLIGENCE GRAPH"
                color={C.teal}
                right={<span className="section-note">Neural agents. Log synchronized.</span>}
              />
              <ExecutionGraph task={activeTask} logs={activeLogs} />
            </div>
          )}
        </div>

        <div className="deploy-side">
          <SectionHeader
            title="LIVE EXECUTION"
            color={C.teal}
            right={activeTask ? (
              <div className="nav-status-indicator is-online" style={{ padding:'4px 8px', minWidth:'auto' }}>
                <span>{activeTask.status}</span>
              </div>
            ) : null}
          />
          <div className="panel execution-shell">
            <ExecutionPanel task={activeTask} logs={activeLogs} deployError={deployError} />
          </div>
        </div>
      </div>
    </Page>
  )
}
