import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from './api'
import type {
  Session, SessionMeta, ExerciseBar, ZoneSlice, BpmPoint, RepRow,
} from './types'
import { Sidebar } from './components/Sidebar'
import { LivePage } from './LivePage'
import { SessionsPage } from './SessionsPage'
import { useAutoRefresh } from './hooks/useAutoRefresh'
import { useLiveSession } from './hooks/useLiveSession'

type View = 'live' | 'sessions'

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
    ...Object.entries(s.max_reps_per_exercise).map(([ex, r])  => [`reps.${ex}`,    String(r)]),
    ...Object.entries(s.fatigue_zone_distribution).map(([z, c]) => [`zone.${z}`,    String(c)]),
    ...Object.entries(s.fatigue_zone_pct).map(([z, p])         => [`zone_pct.${z}`, `${p}%`]),
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
  const { live, apiReachable } = useLiveSession()
  const [view,        setView]        = useState<View>('live')
  const [sessions,    setSessions]    = useState<SessionMeta[]>([])
  const [activeId,    setActiveId]    = useState<string | null>(null)
  const [session,     setSession]     = useState<Session | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [refreshing,  setRefreshing]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const hasAutoSelected = useRef(false)
  const prevLiveActive  = useRef(false)

  // ── Fetch session list ───────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    try {
      const list = await api.listSessions()
      setSessions(list)
      if (list.length > 0 && !hasAutoSelected.current) {
        hasAutoSelected.current = true
        setActiveId(list[0].id)
      }
    } catch (e) {
      console.error('Failed to fetch session list:', e)
    }
  }, [])

  // ── Fetch selected session ───────────────────────────────────────────────
  const fetchSession = useCallback(async (id: string, silent = false) => {
    if (!silent) { setLoading(true); setError(null) }
    else         { setRefreshing(true) }
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

  // Load session when activeId changes
  useEffect(() => {
    if (activeId) fetchSession(activeId)
    else          setSession(null)
  }, [activeId, fetchSession])

  // Auto-refresh: list + current session
  useAutoRefresh(() => {
    fetchList()
    if (activeId) fetchSession(activeId, true)
  }, 5000, autoRefresh)

  // When a live session ends → refresh list + auto-select newest session
  useEffect(() => {
    const isLive = live !== null
    if (prevLiveActive.current && !isLive) {
      // Session just finished recording — refresh list to pick it up
      hasAutoSelected.current = false   // allow re-auto-select of the new session
      fetchList()
      setView('sessions')               // switch to sessions view automatically
    }
    prevLiveActive.current = isLive
  }, [live, fetchList])

  // ── Derived chart data ───────────────────────────────────────────────────
  const exerciseBars = session ? buildExerciseBars(session) : []
  const zoneSlices   = session ? buildZoneSlices(session)   : []
  const bpmPoints    = session ? buildBpmPoints(session)    : []
  const repRows      = session ? buildRepRows(session)      : []

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="layout">
      <Sidebar
        view={view}
        liveActive={live !== null}
        onViewChange={setView}
        sessions={sessions}
        activeId={activeId}
        autoRefresh={autoRefresh}
        onSelect={setActiveId}
        onToggleRefresh={setAutoRefresh}
      />

      <div className="layout__body">
        {view === 'live' ? (
          <LivePage live={live} apiReachable={apiReachable} />
        ) : (
          <SessionsPage
            session={session}
            loading={loading}
            refreshing={refreshing}
            error={error}
            activeId={activeId}
            autoRefresh={autoRefresh}
            exerciseBars={exerciseBars}
            zoneSlices={zoneSlices}
            bpmPoints={bpmPoints}
            repRows={repRows}
            onRetry={() => activeId && fetchSession(activeId)}
            onExport={() => session && exportCsv(session)}
          />
        )}
      </div>
    </div>
  )
}
