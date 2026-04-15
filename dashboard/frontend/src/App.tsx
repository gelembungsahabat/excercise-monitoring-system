import { useState, useEffect, useCallback, useRef } from "react";
import { api, getStoredToken, setStoredToken } from "./api";
import type {
  Session,
  SessionMeta,
  ExerciseBar,
  ZoneSlice,
  BpmPoint,
  RepRow,
  User,
} from "./types";
import { Sidebar } from "./components/Sidebar";
import { LivePage } from "./LivePage";
import { SessionsPage } from "./SessionsPage";
import { LoginPage } from "./LoginPage";
import { UserManagementPage } from "./UserManagementPage";
import { useLiveSession } from "./hooks/useLiveSession";

type View = "live" | "sessions" | "users";

// ── Chart data builders ────────────────────────────────────────────────────

function buildExerciseBars(session: Session): ExerciseBar[] {
  return Object.entries(session.summary.exercise_frame_counts)
    .map(([exercise, frames]) => ({ exercise, frames }))
    .sort((a, b) => b.frames - a.frames);
}

function buildZoneSlices(session: Session): ZoneSlice[] {
  const dist = session.summary.fatigue_zone_distribution;
  const pct = session.summary.fatigue_zone_pct;
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(dist)
    .map(([name, value]) => ({
      name,
      value,
      pct: pct[name] ?? (value / total) * 100,
    }))
    .sort((a, b) => b.value - a.value);
}

function buildBpmPoints(session: Session): BpmPoint[] {
  const step = Math.max(1, Math.floor(session.frames.length / 300));
  return session.frames
    .filter((_, i) => i % step === 0)
    .map((f) => ({
      time: Math.round(f.duration_seconds),
      bpm: f.bpm,
      zone: f.fatigue_zone,
    }));
}

function buildRepRows(session: Session): RepRow[] {
  return Object.entries(session.summary.max_reps_per_exercise).map(
    ([exercise, reps]) => ({ exercise, reps }),
  );
}

// ── CSV export ─────────────────────────────────────────────────────────────

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(session: Session): void {
  const s = session.summary;
  const rows: string[][] = [
    ["Field", "Value"],
    ["session_id", s.session_id],
    ["start_time", s.start_time],
    ["end_time", s.end_time],
    ["duration_seconds", String(s.total_duration_seconds)],
    ["total_frames", String(s.total_frames)],
    ["avg_bpm", String(s.avg_bpm)],
    ["max_bpm", String(s.max_bpm)],
    ["min_bpm", String(s.min_bpm)],
    ...Object.entries(s.max_reps_per_exercise).map(([ex, r]) => [
      `reps.${ex}`,
      String(r),
    ]),
    ...Object.entries(s.fatigue_zone_distribution).map(([z, c]) => [
      `zone.${z}`,
      String(c),
    ]),
    ...Object.entries(s.fatigue_zone_pct).map(([z, p]) => [
      `zone_pct.${z}`,
      `${p}%`,
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `${s.session_id}_summary.csv`);
}

function exportTimelineCsv(session: Session): void {
  if (!session.frames || session.frames.length === 0) return;
  const header = ["duration_seconds", "bpm", "fatigue_zone"];
  const rows = session.frames.map((f) => [
    String(f.duration_seconds),
    String(f.bpm),
    f.fatigue_zone,
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map((c) => `"${c}"`).join(","))
    .join("\n");
  downloadCsv(csv, `${session.session_id}_timeline.csv`);
}

// ── Root component ─────────────────────────────────────────────────────────

export function App() {
  // ── Auth state ───────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // On mount: restore session from localStorage
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    api.getMe()
      .then((user) => setCurrentUser(user))
      .catch(() => setStoredToken(null))
      .finally(() => setAuthChecked(true));
  }, []);

  function handleLogin(user: User, token: string) {
    setStoredToken(token);
    setCurrentUser(user);
  }

  function handleLogout() {
    setStoredToken(null);
    setCurrentUser(null);
  }

  // ── Dashboard state ──────────────────────────────────────────────────────
  const [view, setView] = useState<View>("live");
  const { live, apiReachable } = useLiveSession(view === "live");
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAutoSelected = useRef(false);
  const prevLiveActive = useRef(false);

  // ── Fetch session list ───────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    try {
      const list = await api.listSessions();
      setSessions(list);
      if (list.length > 0 && !hasAutoSelected.current) {
        hasAutoSelected.current = true;
        setActiveId(list[0].id);
      }
    } catch (e) {
      console.error("Failed to fetch session list:", e);
    }
  }, []);

  // ── Fetch selected session ───────────────────────────────────────────────
  const fetchSession = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSession(id);
      setSession(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load (only when authenticated)
  useEffect(() => {
    if (currentUser) fetchList();
  }, [currentUser, fetchList]);

  // Load session when activeId changes
  useEffect(() => {
    if (activeId) fetchSession(activeId);
    else setSession(null);
  }, [activeId, fetchSession]);

  // ── Delete session ───────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.deleteSession(id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeId === id) {
          setActiveId(null);
          setSession(null);
        }
      } catch (e) {
        console.error("Failed to delete session:", e);
        alert(
          "Failed to delete session: " +
            (e instanceof Error ? e.message : String(e)),
        );
      }
    },
    [activeId],
  );

  // When a live session ends → refresh list + auto-select newest session
  useEffect(() => {
    const isLive = live !== null;
    if (prevLiveActive.current && !isLive) {
      hasAutoSelected.current = false;
      fetchList();
      setView("sessions");
    }
    prevLiveActive.current = isLive;
  }, [live, fetchList]);

  // ── Derived chart data ───────────────────────────────────────────────────
  const exerciseBars = session ? buildExerciseBars(session) : [];
  const zoneSlices = session ? buildZoneSlices(session) : [];
  const bpmPoints = session ? buildBpmPoints(session) : [];
  const repRows = session ? buildRepRows(session) : [];

  // ── Render: loading auth check ───────────────────────────────────────────
  if (!authChecked) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--body-bg)",
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  // ── Render: login ────────────────────────────────────────────────────────
  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // ── Render: main dashboard ───────────────────────────────────────────────
  return (
    <div className="layout">
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        view={view}
        liveActive={live !== null}
        onViewChange={(v) => {
          setView(v);
          setSidebarOpen(false);
        }}
        sessions={sessions}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setSidebarOpen(false);
        }}
        onDelete={handleDelete}
        currentUser={currentUser}
        onLogout={handleLogout}
        mobileOpen={sidebarOpen}
      />

      <div className="layout__body">
        <div className="mobile-topbar">
          <button
            className="mobile-topbar__hamburger"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <span />
            <span />
            <span />
          </button>
          <span className="mobile-topbar__title">
            Fit<b>Track</b> AI
          </span>
        </div>

        {view === "live" ? (
          <LivePage live={live} apiReachable={apiReachable} />
        ) : view === "users" ? (
          <UserManagementPage currentUserId={currentUser.id} />
        ) : (
          <SessionsPage
            session={session}
            loading={loading}
            error={error}
            activeId={activeId}
            exerciseBars={exerciseBars}
            zoneSlices={zoneSlices}
            bpmPoints={bpmPoints}
            repRows={repRows}
            onRetry={() => activeId && fetchSession(activeId)}
            onExport={() => session && exportCsv(session)}
            onExportTimeline={() => session && exportTimelineCsv(session)}
          />
        )}
      </div>
    </div>
  );
}
