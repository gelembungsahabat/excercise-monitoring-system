import type { Session } from '../types'

interface Props {
  session:  Session | null
  onExport: () => void
}

function fmtDateTime(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Download SVG icon
function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  )
}

// Activity chart icon for header
function IconActivity() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}

export function Header({ session, onExport }: Props) {
  return (
    <header className="header">
      <div className="header__icon">
        <IconActivity />
      </div>

      <div className="header__info">
        {session ? (
          <>
            <div className="header__title">{session.session_id}</div>
            <div className="header__sub">
              {fmtDateTime(session.start_time)}
              {session.end_time ? ` → ${fmtDateTime(session.end_time)}` : ''}
            </div>
          </>
        ) : (
          <div className="header__placeholder">Select a session from the sidebar</div>
        )}
      </div>

      <div className="header__actions">
        {session && (
          <button className="btn btn--outline" onClick={onExport} title="Export summary as CSV">
            <IconDownload />
            Export CSV
          </button>
        )}
      </div>
    </header>
  )
}
