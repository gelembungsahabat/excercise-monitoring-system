import type { SessionMeta } from '../types'

interface Props {
  sessions: SessionMeta[]
  activeId: string | null
  autoRefresh: boolean
  onSelect: (id: string) => void
  onToggleRefresh: (v: boolean) => void
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }
  return `${m}m ${s}s`
}

export function Sidebar({ sessions, activeId, autoRefresh, onSelect, onToggleRefresh }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar__logo">
        <span className="sidebar__logo-icon">💪</span>
        <span className="sidebar__logo-text">
          Fit<span>Track</span> AI
        </span>
      </div>

      <div className="sidebar__section-label">Sessions</div>

      <div className="sidebar__sessions">
        {sessions.length === 0 ? (
          <div style={{ padding: '12px', color: 'var(--sidebar-text)', fontSize: 'var(--text-xs)' }}>
            No sessions found. Record one with the main app.
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item${s.id === activeId ? ' session-item--active' : ''}`}
              onClick={() => onSelect(s.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(s.id)}
            >
              <div className="session-item__date">
                {formatDate(s.start_time)} · {formatTime(s.start_time)}
              </div>
              <div className="session-item__meta">
                {formatDuration(s.duration_seconds)} · {s.exercises.slice(0, 2).join(', ')}
                {s.exercises.length > 2 ? ` +${s.exercises.length - 2}` : ''}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="sidebar__footer">
        <label className="toggle sidebar__refresh">
          <input
            type="checkbox"
            className="toggle__input"
            checked={autoRefresh}
            onChange={(e) => onToggleRefresh(e.target.checked)}
          />
          <span className="toggle__track" />
          {autoRefresh && <span className="live-dot" style={{ marginLeft: 4 }} />}
          Auto-refresh (5 s)
        </label>
      </div>
    </aside>
  )
}
