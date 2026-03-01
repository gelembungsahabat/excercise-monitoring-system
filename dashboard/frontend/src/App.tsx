import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from './api'
import type {
  Session, SessionMeta, ExerciseBar, ZoneSlice, BpmPoint, RepRow,
} from './types'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { MetricCards } from './components/MetricCards'
import { ExerciseChart } from './components/ExerciseChart'
import { ZonePieChart } from './components/ZonePieChart'
import { BpmChart } from './components/BpmChart'
import { RepsTable } from './components/RepsTable'
import { useAutoRefresh } from './hooks/useAutoRefresh'

// ── Chart data builders ────────────────────────────────────────────────────

function buildExerciseBars(session: Session): ExerciseBar[] {
  return Object.entries(session.summary.exercise_frame_counts)
    .map(([exercise, frames]) => ({ exercise, frames }))
    .sort((a, b) => b.frames - a.frames)
}

function buildZoneSlices(session: Session): ZoneSlice[] {
  const dist  = session.summary.fatigue_zone_distribution
  const pct   = session.summary.fatigue_zone_pct
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1
  return Object.entries(dist)
    .map(([name, value]) => ({
      name,
      value,
      pct: pct[name] ?? (value / total * 100),
    }))
    .sort((a, b) => b.value - a.value)
}

function buildBpmPoints(session: Session): BpmPoint[] {
  const step = Math.max(1, Math.floor(session.frames.length / 300))
  return session.frames
    .filter((_, i) => i % step === 0)
    .map((f) => ({
      time: Math.round(f.duration_seconds),
      bpm:  f.bpm,
      zone: f.fatigue_zone,
    }))
}

function buildRepRows(session: Session): RepRow[] {
  return Object.entries(session.summary.max_reps_per_exercise)
    .map(([exercise, reps]) => ({ exercise, reps }))
}

// ── CSV export ─────────────────────────────────────────────────────────────

function exportCsv(session: Session): void {
  const s = session.summary
  const rows: string[][] = [
    ['Field', 'Value'],
    ['session_id',       s.session_id],
    ['start_time',       s.start_time],
    ['end_time',         s.end_time],
    ['duration_seconds', String(s.total_duration_seconds)],
    ['total_frames',     String(s.total_frames)],
    ['avg_bpm',          String(s.avg_bpm)],
    ['max_bpm',          String(s.max_bpm)],
    ['min_bpm',          String(s.min_bpm)],
    ...Object.entries(s.max_reps_per_exercise).map(([ex, r])  => [`reps.${ex}`,     String(r)]),
    ...Object.entries(s.fatigue_zone_distribution).map(([z, c]) => [`zone.${z}`,     String(c)]),
    ...Object.entries(s.fatigue_zone_pct).map(([z, p])         => [`zone_pct.${z}`,  `${p}%`]),
  ]
  const csv  = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${s.session_id}_summary.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Root component ─────────────────────────────────────────────────────────

export function App() {
  const [sessions,    setSessions]    = useState<SessionMeta[]>([])
  const [activeId,    setActiveId]    = useState<string | null>(null)
  const [session,     setSession]     = useState<Session | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [refreshing,  setRefreshing]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  // Tracks whether the initial auto-select has fired (stable ref — no re-render)
  const hasAutoSelected = useRef(false)

  // ── Fetch session list ───────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    try {
      const list = await api.listSessions()
      setSessions(list)
      // Auto-select the newest session only once on first load
      if (list.length > 0 && !hasAutoSelected.current) {
        hasAutoSelected.current = true
        setActiveId(list[0].id)
      }
    } catch (e) {
      console.error('Failed to fetch session list:', e)
    }
  }, [])

  // ── Fetch selected session (full data) ──────────────────────────────────
  const fetchSession = useCallback(async (id: string, silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    } else {
      setRefreshing(true)
    }
    try {
      const data = await api.getSession(id)
      setSession(data)
      setError(null)
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : 'Failed to load session')
        setSession(null)
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Initial load
  useEffect(() => { fetchList() }, [fetchList])

  // Load session whenever activeId changes
  useEffect(() => {
    if (activeId) fetchSession(activeId)
    else setSession(null)
  }, [activeId, fetchSession])

  // Auto-refresh: silent re-fetch of list + active session
  useAutoRefresh(() => {
    fetchList()
    if (activeId) fetchSession(activeId, true)
  }, 5000, autoRefresh)

  // ── Derived chart data ───────────────────────────────────────────────────
  const exerciseBars = session ? buildExerciseBars(session) : []
  const zoneSlices   = session ? buildZoneSlices(session)   : []
  const bpmPoints    = session ? buildBpmPoints(session)    : []
  const repRows      = session ? buildRepRows(session)      : []

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="layout">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        autoRefresh={autoRefresh}
        onSelect={setActiveId}
        onToggleRefresh={setAutoRefresh}
      />

      <div className="layout__body">
        <Header
          session={session}
          autoRefresh={autoRefresh}
          onExport={() => session && exportCsv(session)}
        />

        <main className="content">

          {/* ── No session selected ── */}
          {!activeId && !loading && (
            <div className="empty">
              <div className="empty__icon">🏋️</div>
              <div className="empty__title">No session selected</div>
              <div className="empty__text">
                Pick a session from the sidebar, or record one with the main app.
              </div>
            </div>
          )}

          {/* ── Initial loading spinner ── */}
          {loading && (
            <div className="empty">
              <div className="spinner" />
              <div className="empty__text">Loading session…</div>
            </div>
          )}

          {/* ── Error state ── */}
          {error && !loading && (
            <div className="empty">
              <div className="empty__icon">⚠️</div>
              <div className="empty__title">Failed to load session</div>
              <div className="empty__text">{error}</div>
              <button
                className="btn btn--primary"
                onClick={() => activeId && fetchSession(activeId)}
              >
                Retry
              </button>
            </div>
          )}

          {/* ── Session content ── */}
          {session && !loading && !error && (
            <>
              {/* Subtle refreshing banner */}
              {refreshing && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 16px', marginBottom: 'var(--s4)',
                  background: 'var(--brand-light)', borderRadius: 'var(--r-md)',
                  fontSize: 'var(--t-xs)', color: 'var(--brand)',
                  fontWeight: 600,
                }}>
                  <span className="live-dot" />
                  Refreshing data…
                </div>
              )}

              {/* Metric cards */}
              <MetricCards summary={session.summary} />

              {/* Charts row — 2 columns */}
              <div className="grid-2">
                <div className="card">
                  <div className="card__head">
                    <span className="card__title">Exercise Distribution</span>
                  </div>
                  <div className="card__body">
                    <ExerciseChart data={exerciseBars} />
                  </div>
                </div>

                <div className="card">
                  <div className="card__head">
                    <span className="card__title">Fatigue Zone Breakdown</span>
                  </div>
                  <div className="card__body">
                    <ZonePieChart data={zoneSlices} />
                  </div>
                </div>
              </div>

              {/* BPM timeline — full width */}
              <div className="card">
                <div className="card__head">
                  <span className="card__title">Heart Rate Over Time</span>
                </div>
                <div className="card__body">
                  <BpmChart data={bpmPoints} />
                </div>
              </div>

              {/* Reps table */}
              <div className="card">
                <div className="card__head">
                  <span className="card__title">Reps Per Exercise</span>
                </div>
                <RepsTable data={repRows} />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
