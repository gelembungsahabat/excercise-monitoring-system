import type { SessionMeta } from '../types'

interface Props {
  sessions: SessionMeta[]
  activeId: string | null
  autoRefresh: boolean
  onSelect: (id: string) => void
  onToggleRefresh: (v: boolean) => void
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, opts)
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m ${Math.floor(s % 60)}s`
}

export function Sidebar({ sessions, activeId, autoRefresh, onSelect, onToggleRefresh }: Props) {
  const switchId = 'auto-refresh-switch'

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo__mark">💪</div>
        <div className="sidebar-logo__wordmark">
          <div className="sidebar-logo__name">
            Fit<span>Track</span> AI
          </div>
          <div className="sidebar-logo__tagline">Exercise Dashboard</div>
        </div>
      </div>

      {/* Session list */}
      <div className="sidebar-group">
        <div className="sidebar-group__label">Sessions</div>

        {sessions.length === 0 ? (
          <div style={{ padding: '12px 10px', color: 'var(--sb-text)', fontSize: 'var(--t-xs)', lineHeight: 1.6 }}>
            No sessions found.<br />Record one using the main app.
          </div>
        ) : (
          sessions.map((s) => {
            const active = s.id === activeId
            return (
              <div
                key={s.id}
                className={`session-item${active ? ' session-item--active' : ''}`}
                onClick={() => onSelect(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(s.id)}
                aria-pressed={active}
              >
                <div className="session-item__date">
                  {fmt(s.start_time, { month: 'short', day: 'numeric', year: 'numeric' })}
                  &nbsp;·&nbsp;
                  {fmt(s.start_time, { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="session-item__meta">
                  {fmtDuration(s.duration_seconds)}
                  {s.avg_bpm > 0 ? ` · avg ${Math.round(s.avg_bpm)} bpm` : ''}
                </div>
                {s.exercises.length > 0 && (
                  <div className="session-item__pills">
                    {s.exercises.slice(0, 3).map((ex) => (
                      <span key={ex} className="session-pill">{ex}</span>
                    ))}
                    {s.exercises.length > 3 && (
                      <span className="session-pill">+{s.exercises.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-footer__label">Options</div>
        <div className="toggle-row">
          <div className="toggle-row__text">
            {autoRefresh && <span className="live-dot" />}
            Auto-refresh (5 s)
          </div>
          <label className="switch" htmlFor={switchId}>
            <input
              id={switchId}
              type="checkbox"
              className="switch__input"
              checked={autoRefresh}
              onChange={(e) => onToggleRefresh(e.target.checked)}
            />
            <span className="switch__track" />
          </label>
        </div>
      </div>
    </aside>
  )
}
