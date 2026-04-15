import { Activity, TrendingUp, Users, LogOut, X } from "lucide-react";
import type { SessionMeta, User } from "../types";

type View = "live" | "sessions" | "users";

interface Props {
  view: View;
  liveActive: boolean;
  onViewChange: (v: View) => void;
  sessions: SessionMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  currentUser: User | null;
  onLogout: () => void;
  mobileOpen?: boolean;
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, opts);
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${Math.floor(s % 60)}s`;
}

export function Sidebar({
  view,
  liveActive,
  onViewChange,
  sessions,
  activeId,
  onSelect,
  onDelete,
  currentUser,
  onLogout,
  mobileOpen,
}: Props) {
  return (
    <aside className={`sidebar${mobileOpen ? " sidebar--mobile-open" : ""}`}>
      {/* ── Logo ─────────────────────────────────────────────────── */}
      <div className="sidebar-logo">
        <div className="sidebar-logo__mark">💪</div>
        <div className="sidebar-logo__wordmark">
          <div className="sidebar-logo__name">
            Fit<span>Track</span> AI
          </div>
          <div className="sidebar-logo__tagline">Exercise Dashboard</div>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <div className="sidebar-nav">
        <div className="sidebar-nav__label">Menu</div>

        <div
          className={`nav-item${view === "live" ? " nav-item--active" : ""}`}
          onClick={() => onViewChange("live")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onViewChange("live")}
        >
          <div className="nav-item__icon"><Activity size={16} /></div>
          <span className="nav-item__label">Live Tracking</span>
          {liveActive && (
            <div className="nav-item__live-badge">
              <span
                className="live-dot"
                style={{
                  background: "#ef4444",
                  boxShadow: "0 0 0 2px rgba(239,68,68,0.25)",
                }}
              />
              LIVE
            </div>
          )}
        </div>

        <div
          className={`nav-item${view === "sessions" ? " nav-item--active" : ""}`}
          onClick={() => onViewChange("sessions")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onViewChange("sessions")}
        >
          <div className="nav-item__icon"><TrendingUp size={16} /></div>
          <span className="nav-item__label">Sessions</span>
          {sessions.length > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: "rgba(255,255,255,0.12)",
                color: view === "sessions" ? "#fff" : "var(--sb-text-hi)",
                padding: "1px 6px",
                borderRadius: "var(--r-full)",
              }}
            >
              {sessions.length}
            </span>
          )}
        </div>

        {currentUser?.role === "admin" && (
          <div
            className={`nav-item${view === "users" ? " nav-item--active" : ""}`}
            onClick={() => onViewChange("users")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onViewChange("users")}
          >
            <div className="nav-item__icon"><Users size={16} /></div>
            <span className="nav-item__label">User Management</span>
          </div>
        )}
      </div>

      {/* ── Session list ─────────────────────────────────────────── */}
      <div className="sidebar-group" style={{ flex: 1, overflowY: "auto" }}>
        <div className="sidebar-group__label">Recent Sessions</div>

        {sessions.length === 0 ? (
          <div
            style={{
              padding: "10px var(--s3)",
              color: "var(--sb-text)",
              fontSize: "var(--t-xs)",
              lineHeight: 1.6,
            }}
          >
            No sessions yet.
            <br />
            Record one with the main app.
          </div>
        ) : (
          sessions.map((s) => {
            const active = s.id === activeId;
            return (
              <div
                key={s.id}
                className={`session-item${active ? " session-item--active" : ""}`}
                onClick={() => {
                  onSelect(s.id);
                  onViewChange("sessions");
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  (onSelect(s.id), onViewChange("sessions"))
                }
                style={{ position: "relative" }}
              >
                <div className="session-item__date">
                  {fmt(s.start_time, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  &nbsp;·&nbsp;
                  {fmt(s.start_time, { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="session-item__meta">
                  {fmtDuration(s.duration_seconds)}
                  {s.avg_bpm > 0 ? ` · avg ${Math.round(s.avg_bpm)} bpm` : ""}
                </div>
                {s.exercises.length > 0 && (
                  <div className="session-item__pills">
                    {s.exercises.slice(0, 3).map((ex) => (
                      <span key={ex} className="session-pill">
                        {ex}
                      </span>
                    ))}
                    {s.exercises.length > 3 && (
                      <span className="session-pill">
                        +{s.exercises.length - 3}
                      </span>
                    )}
                  </div>
                )}
                <button
                  title="Delete session"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm("Delete this session? This cannot be undone.")) {
                      onDelete(s.id);
                    }
                  }}
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--sb-text)",
                    opacity: 0.8,
                    fontSize: 13,
                    lineHeight: 1,
                    padding: "2px 4px",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                    (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = "0.45";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--sb-text)";
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* ── User info + logout ────────────────────────────────────── */}
      {currentUser && (
        <div className="sidebar-user">
          <div className="sidebar-user__avatar">
            {currentUser.username[0].toUpperCase()}
          </div>
          <div className="sidebar-user__info">
            <div className="sidebar-user__name">{currentUser.username}</div>
            <div className="sidebar-user__role">{currentUser.role}</div>
          </div>
          <button
            className="sidebar-user__logout"
            onClick={onLogout}
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      )}
    </aside>
  );
}
