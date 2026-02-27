import type { Session } from '../types'

interface Props {
  session: Session | null
  onExport: () => void
}

function formatDateTime(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function Header({ session, onExport }: Props) {
  return (
    <header className="header">
      <div className="header__title">
        {session ? (
          <>
            <div className="header__session-name">{session.session_id}</div>
            <div className="header__session-date">
              {formatDateTime(session.start_time)}
              {session.end_time ? ` → ${formatDateTime(session.end_time)}` : ''}
            </div>
          </>
        ) : (
          <div className="header__session-name" style={{ color: 'var(--text-muted)' }}>
            Select a session
          </div>
        )}
      </div>

      <div className="header__actions">
        {session && (
          <button className="btn btn--ghost" onClick={onExport} title="Export summary as CSV">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
        )}
      </div>
    </header>
  )
}
