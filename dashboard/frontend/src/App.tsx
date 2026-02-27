import { useState, useEffect, useCallback } from 'react'
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
  const counts = session.summary.exercise_frame_counts
  return Object.entries(counts)
    .map(([exercise, frames]) => ({ exercise, frames }))
    .sort((a, b) => b.frames - a.frames)
}

function buildZoneSlices(session: Session): ZoneSlice[] {
  const dist = session.summary.fatigue_zone_distribution
  const pct  = session.summary.fatigue_zone_pct
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
  // Sample every 10th frame to keep chart performant
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
  const summary = session.summary
  const rows: string[][] = [
    ['Field', 'Value'],
    ['session_id',         summary.session_id],
    ['start_time',         summary.start_time],
    ['end_time',           summary.end_time],
    ['duration_seconds',   String(summary.total_duration_seconds)],
    ['total_frames',       String(summary.total_frames)],
    ['avg_bpm',            String(summary.avg_bpm)],
    ['max_bpm',            String(summary.max_bpm)],
    ['min_bpm',            String(summary.min_bpm)],
    ...Object.entries(summary.max_reps_per_exercise).map(([ex, r]) => [`reps.${ex}`, String(r)]),
    ...Object.entries(summary.fatigue_zone_distribution).map(([z, c]) => [`zone.${z}`, String(c)]),
    ...Object.entries(summary.fatigue_zone_pct).map(([z, p]) => [`zone_pct.${z}`, `${p}%`]),
  ]
  const csv  = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${summary.session_id}_summary.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Root component ─────────────────────────────────────────────────────────

export function App() {
  const [sessions,     setSessions]     = useState<SessionMeta[]>([])
  const [activeId,     setActiveId]     = useState<string | null>(null)
  const [session,      setSession]      = useState<Session | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [autoRefresh,  setAutoRefresh]  = useState(false)

  // ── Fetch session list ───────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    try {
      const list = await api.listSessions()
      setSessions(list)
      // Auto-select the newest session on first load
      if (list.length > 0 && activeId === null) {
        setActiveId(list[0].id)
      }
    } catch (e) {
      console.error('Failed to fetch session list:', e)
    }
  }, [activeId])

  // ── Fetch selected session ───────────────────────────────────────────────
  const fetchSession = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getSession(id)
      setSession(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session')
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { fetchList() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load session when activeId changes
  useEffect(() => {
    if (activeId) fetchSession(activeId)
  }, [activeId, fetchSession])

  // Auto-refresh: re-fetch the current session + list
  useAutoRefresh(() => {
    fetchList()
    if (activeId) fetchSession(activeId)
  }, 5000, autoRefresh)

  // ── Chart data (derived) ─────────────────────────────────────────────────
  const exerciseBars = session ? buildExerciseBars(session) : []
  const zoneSlices   = session ? buildZoneSlices(session) : []
  const bpmPoints    = session ? buildBpmPoints(session) : []
  const repRows      = session ? buildRepRows(session) : []

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

      <div className="layout__main">
        <Header
          session={session}
          onExport={() => session && exportCsv(session)}
        />

        <main className="content">
          {/* ── No session selected ── */}
          {!activeId && (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="empty-state__icon">🏋️</div>
              <div className="empty-state__title">No session selected</div>
              <div className="empty-state__text">
                Pick a session from the sidebar, or record one with the main app.
              </div>
            </div>
          )}

          {/* ── Loading ── */}
          {activeId && loading && !session && (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="spinner" />
              <div className="empty-state__text">Loading session…</div>
            </div>
          )}

          {/* ── Error ── */}
          {error && (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="empty-state__icon">⚠️</div>
              <div className="empty-state__title">Failed to load</div>
              <div className="empty-state__text">{error}</div>
              <button
                className="btn btn--primary"
                onClick={() => activeId && fetchSession(activeId)}
              >
                Retry
              </button>
            </div>
          )}

          {/* ── Session content ── */}
          {session && !error && (
            <>
              {/* Metric cards */}
              <MetricCards summary={session.summary} />

              {/* Charts row */}
              <div className="content__row content__row--2col">
                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Exercise Distribution</span>
                  </div>
                  <div className="card__body">
                    <ExerciseChart data={exerciseBars} />
                  </div>
                </div>

                <div className="card">
                  <div className="card__header">
                    <span className="card__title">Fatigue Zone Breakdown</span>
                  </div>
                  <div className="card__body">
                    <ZonePieChart data={zoneSlices} />
                  </div>
                </div>
              </div>

              {/* BPM timeline (full width) */}
              <div className="card">
                <div className="card__header">
                  <span className="card__title">Heart Rate Over Time</span>
                  {autoRefresh && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--success)' }}>
                      <span className="live-dot" /> Live
                    </span>
                  )}
                </div>
                <div className="card__body">
                  <BpmChart data={bpmPoints} />
                </div>
              </div>

              {/* Reps table */}
              <div className="card">
                <div className="card__header">
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
