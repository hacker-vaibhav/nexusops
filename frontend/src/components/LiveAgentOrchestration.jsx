import { useMemo } from 'react'
import { SectionHeader, LogStream } from './UI'
import ExecutionGraph from './ExecutionGraph'

const C = {
  teal: '#00c8e8',
  green: '#00e676',
  amber: '#ffab40',
  red: '#ff5252',
  purple: '#b388ff',
}

export default function LiveAgentOrchestration({ task, logs = [] }) {
  const totalRetries = useMemo(
    () => (task?.steps || []).reduce((sum, step) => sum + (Number(step.retries) || 0), 0),
    [task]
  )

  if (!task) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Select a task to visualize agent orchestration
      </div>
    )
  }

  const taskStatus = task.status || 'pending'
  const statusColor = taskStatus === 'completed' || taskStatus === 'verified'
    ? C.green
    : taskStatus === 'failed'
      ? C.red
      : taskStatus === 'retrying'
        ? C.amber
        : C.teal

  return (
    <div style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionHeader
        title="AGENT EXECUTION"
        color={statusColor}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: statusColor, letterSpacing: '0.08em' }}>
              {taskStatus.toUpperCase()}
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                color: C.amber,
                padding: '4px 8px',
                borderRadius: 999,
                background: 'rgba(255,171,64,0.08)',
                border: '1px solid rgba(255,171,64,0.2)',
              }}
            >
              ↺ {totalRetries}
            </span>
          </div>
        }
      />

      <ExecutionGraph task={task} logs={logs} />

      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
            AI TRANSCRIPT
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.teal }}>
            AI agents communicating in real time
          </div>
        </div>
        <LogStream logs={logs} height={220} />
      </div>
    </div>
  )
}
