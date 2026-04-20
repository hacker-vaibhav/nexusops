import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, History as HistoryIcon } from 'lucide-react'
import { Page, SectionHeader, EmptyState } from '../components/UI'
import { fetchHistory } from '../utils/api'
import { timeAgo, getCatalogItem } from '../shared/store'

const C = { teal:'#00d9ff', green:'#00f38d', amber:'#ffbe46', purple:'#b67dff' }
const AUTO_TERMINATE_MS = 5 * 60 * 1000

function formatCountdown(targetIso, nowTs) {
  if (!targetIso) return 'persistent'
  const target = new Date(targetIso).getTime()
  if (Number.isNaN(target)) return 'persistent'
  const diff = target - nowTs
  if (diff <= 0) return 'expired'
  const totalSeconds = Math.floor(diff / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} left`
}

export default function HistoryPage() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [nowTs, setNowTs] = useState(Date.now())

  useEffect(() => {
    let mounted = true
    fetchHistory().then(items => {
      if (mounted) {
        setEntries(items || [])
        setLoading(false)
      }
    }).catch(() => {
      if (mounted) setLoading(false)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const iv = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
  }, [entries])

  return (
    <Page>
      <SectionHeader
        title="HISTORY"
        color={C.purple}
        right={<span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', letterSpacing:'0.12em', textTransform:'uppercase' }}>
          latest deployments from redis
        </span>}
      />

      {loading ? (
        <div className="panel" style={{ padding:20, color:'var(--text-muted)' }}>
          Loading deployment history...
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon size={18} />}
          title="No deployments yet"
          body="Run a deployment and it will appear here with the public URL and instance ID."
        />
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {sortedEntries.map((entry, index) => {
            const cat = getCatalogItem({ ticket: entry.service || '' })
            const url = entry.url || entry.public_url
            const expiresAt = entry.expires_at
              || (entry.mode === 'real' && entry.timestamp ? new Date(new Date(entry.timestamp).getTime() + AUTO_TERMINATE_MS).toISOString() : null)
            const countdown = formatCountdown(expiresAt, nowTs)
            const countdownColor = countdown === 'expired' ? C.amber : countdown === 'persistent' ? 'var(--text-muted)' : C.green
            const badgeLabel = entry.mode === 'real' ? 'real aws' : 'mock'
            const cleanupLabel = expiresAt ? `Auto cleanup ${countdown}` : 'Persistent'
            return (
              <a
                key={`${entry.task_id || 'history'}-${entry.timestamp || 'ts'}-${index}`}
                href={url || '#'}
                target="_blank"
                rel="noreferrer"
                className="panel"
                style={{
                  display:'flex',
                  flexDirection:'column',
                  gap:12,
                  textDecoration:'none',
                  padding:16,
                  borderColor:index === 0 ? 'rgba(0,243,141,0.22)' : 'var(--border)',
                }}
              >
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                    <span style={{
                      display:'inline-flex',
                      alignItems:'center',
                      padding:'6px 10px',
                      borderRadius:999,
                      background:'rgba(0,0,0,0.18)',
                      border:'1px solid var(--border)',
                      color:countdownColor,
                      fontFamily:'var(--font-mono)',
                      fontSize:11,
                      fontWeight:700,
                      letterSpacing:'0.08em',
                      textTransform:'uppercase',
                      whiteSpace:'nowrap',
                    }}>
                      {countdown}
                    </span>
                    <div>
                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, color:'var(--text-primary)', fontSize:16 }}>
                          {entry.service || cat?.name || 'Service'}
                        </div>
                        <span style={{
                          fontFamily:'var(--font-mono)',
                          fontSize:10,
                          letterSpacing:'0.12em',
                          textTransform:'uppercase',
                          color:'var(--text-muted)',
                          padding:'3px 8px',
                          borderRadius:999,
                          border:'1px solid var(--border)',
                        }}>
                          {badgeLabel}
                        </span>
                      </div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
                        {entry.status || 'completed'} • {timeAgo(entry.timestamp)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:10, width:'100%' }}>
                    <div style={{
                      padding:'10px 12px',
                      borderRadius:12,
                      background:'rgba(0,0,0,0.14)',
                      border:'1px solid var(--border)',
                      minWidth:0,
                    }}>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:4 }}>
                        Public URL
                      </div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:C.teal, wordBreak:'break-all' }}>
                        {url || 'n/a'}
                      </div>
                    </div>
                    <div style={{
                      padding:'10px 12px',
                      borderRadius:12,
                      background:'rgba(0,0,0,0.14)',
                      border:'1px solid var(--border)',
                      minWidth:0,
                    }}>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:4 }}>
                        Instance ID
                      </div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:C.green, wordBreak:'break-all' }}>
                        {entry.instance_id || 'n/a'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:6, color:C.amber, fontFamily:'var(--font-mono)', fontSize:10 }}>
                      <ExternalLink size={12} />
                      Open deployment
                    </span>
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)' }}>
                      {cleanupLabel}
                    </span>
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </Page>
  )
}
