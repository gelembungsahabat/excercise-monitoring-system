import { useState, useRef, useCallback } from 'react'
import type { LiveSession } from './hooks/useLiveSession'
import { useBrowserTracker } from './hooks/useBrowserTracker'
import { ZONE_COLORS } from './types'
import type { ExerciseBar, ZoneSlice, BpmPoint, RepRow } from './types'
import { ExerciseChart }  from './components/ExerciseChart'
import { ZonePieChart }   from './components/ZonePieChart'
import { BpmChart }       from './components/BpmChart'
import { RepsTable }      from './components/RepsTable'
import { AiInsightCard }  from './components/AiInsightCard'

// ── Data builders ─────────────────────────────────────────────────────────────

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function buildExerciseBars(live: LiveSession): ExerciseBar[] {
  const frameCounts = live.summary.exercise_frame_counts ?? {}
  const repCounts   = live.summary.max_reps_per_exercise  ?? {}
  const source = Object.keys(frameCounts).length > 0 ? frameCounts : repCounts
  return Object.entries(source)
    .filter(([, v]) => v > 0)
    .map(([exercise, frames]) => ({ exercise, frames }))
    .sort((a, b) => b.frames - a.frames)
}

function buildZoneSlices(live: LiveSession): ZoneSlice[] {
  const dist  = live.summary.fatigue_zone_distribution ?? {}
  const total = live.total_frames || 1
  return Object.entries(dist)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value, pct: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value)
}

function buildBpmPoints(live: LiveSession): BpmPoint[] {
  return live.bpm_history.map((bpm, i) => {
    const offsetFromNow = live.bpm_history.length - 1 - i
    const time = Math.max(0, Math.round(live.elapsed_seconds - offsetFromNow))
    return { time, bpm, zone: live.zone }
  })
}

function buildRepRows(live: LiveSession): RepRow[] {
  return Object.entries(live.summary.max_reps_per_exercise)
    .map(([exercise, reps]) => ({ exercise, reps }))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MCard({ icon, iconClass, label, value, sub, valueColor }: {
  icon: string; iconClass: string; label: string
  value: string; sub?: string; valueColor?: string
}) {
  return (
    <div className="mcard">
      <div className={`mcard__icon ${iconClass}`}>{icon}</div>
      <div className="mcard__body">
        <div className="mcard__label">{label}</div>
        <div className="mcard__value" style={{ color: valueColor }}>{value}</div>
        {sub && <div className="mcard__sub">{sub}</div>}
      </div>
    </div>
  )
}

// ── Webcam canvas card ────────────────────────────────────────────────────────

function WebcamCard({
  videoRef, canvasRef, onStop, stopping,
}: {
  videoRef:  React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onStop:    () => void
  stopping:  boolean
}) {
  return (
    <div className="card" style={{ overflow: 'hidden', flex: '0 0 auto', width: 400 }}>
      <div className="card__head" style={{ padding: '10px 14px' }}>
        <div className="card__head-left">
          <div className="card__title-icon" style={{ fontSize: 13 }}>📷</div>
          <span className="card__title" style={{ fontSize: 'var(--t-sm)' }}>Live Camera</span>
        </div>
        <button
          className="btn btn--danger"
          onClick={onStop}
          disabled={stopping}
          style={{ minWidth: 110, fontSize: 'var(--t-xs)', padding: '5px 10px' }}
        >
          {stopping ? 'Saving…' : '■  Stop'}
        </button>
      </div>
      {/* Hidden video element — feeds canvas */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ display: 'none' }}
      />
      {/* Visible canvas with pose overlay */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          display: 'block',
          borderRadius: '0 0 var(--r-lg) var(--r-lg)',
          background: '#1a1a1a',
          aspectRatio: '4/3',
          objectFit: 'contain',
        }}
      />
    </div>
  )
}

// ── BPM input ─────────────────────────────────────────────────────────────────

function BpmInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(String(value))

  const commit = () => {
    const n = parseInt(draft, 10)
    if (!isNaN(n) && n > 0 && n < 300) onChange(n)
    else setDraft(String(value))
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        min={40} max={250}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          width: 70, textAlign: 'center', fontSize: 'var(--t-sm)',
          fontWeight: 700, fontFamily: 'var(--font-mono)',
          background: 'var(--input-bg)', color: 'var(--text-h)',
          border: '1px solid var(--brand)', borderRadius: 6, padding: '2px 6px',
        }}
      />
    )
  }

  return (
    <button
      onClick={() => { setDraft(String(value)); setEditing(true) }}
      title="Click to set BPM manually"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 'var(--t-sm)', fontWeight: 700, fontFamily: 'var(--font-mono)',
        color: 'var(--text-h)', padding: 0,
      }}
    >
      {value} <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>✏️</span>
    </button>
  )
}

// ── Idle / error states ───────────────────────────────────────────────────────

function ApiDownState() {
  return (
    <div className="empty" style={{ flex: 1 }}>
      <div className="empty__icon" style={{ fontSize: 32 }}>🔌</div>
      <div className="empty__title">API server not reachable</div>
      <div className="empty__text" style={{ maxWidth: 420, lineHeight: 1.9 }}>
        Start the backend first:<br /><br />
        <code style={{ background: 'var(--input-bg)', padding: '2px 8px', borderRadius: 4 }}>
          uvicorn dashboard.api:app --port 8000
        </code>
        <br /><br />Then refresh this page.
      </div>
    </div>
  )
}

function IdleState({
  loading, error, onStart,
}: { loading: boolean; error: string | null; onStart: () => void }) {
  return (
    <div className="empty" style={{ flex: 1 }}>
      <div className="empty__icon" style={{ fontSize: 32 }}>📡</div>
      <div className="empty__title">No active session</div>
      <div className="empty__text" style={{ maxWidth: 380, lineHeight: 1.9 }}>
        {loading
          ? 'Loading MediaPipe model (first start may take a moment)…'
          : 'Click below to start your webcam and begin tracking.'}
      </div>
      {error && (
        <div style={{ color: '#ef4444', fontSize: 'var(--t-xs)', marginTop: 8, maxWidth: 360 }}>
          {error}
        </div>
      )}
      <button
        className="btn btn--primary"
        onClick={onStart}
        disabled={loading}
        style={{ marginTop: 20, minWidth: 160 }}
      >
        {loading ? 'Starting…' : '▶  Start Tracker'}
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { live: LiveSession | null; apiReachable: boolean }

export function LivePage({ live, apiReachable }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stopping, setStopping] = useState(false)

  const { state: tracker, start, stop, setBpm } = useBrowserTracker(videoRef, canvasRef)

  const handleStart = useCallback(async () => {
    await start(120)
  }, [start])

  const handleStop = useCallback(async () => {
    setStopping(true)
    try { await stop() }
    finally { setStopping(false) }
  }, [stop])

  if (!apiReachable) return <ApiDownState />

  if (!tracker.isRunning && !live) {
    return <IdleState loading={tracker.isLoading} error={tracker.error} onStart={handleStart} />
  }

  // Use browser tracker state when running; fall back to server live state for display
  const displayLive = live ?? null
  const exercise   = tracker.isRunning ? tracker.exercise  : (displayLive?.exercise  ?? 'Standing')
  const confidence = tracker.isRunning ? tracker.confidence : (displayLive?.confidence ?? 0)
  const bpm        = tracker.isRunning ? tracker.bpm        : (displayLive?.bpm        ?? 0)
  const zone       = tracker.isRunning ? tracker.zone       : (displayLive?.zone       ?? 'Normal')
  const reps       = tracker.isRunning ? tracker.reps       : (displayLive?.reps       ?? 0)
  const elapsed    = tracker.isRunning ? tracker.elapsedSeconds : (displayLive?.elapsed_seconds ?? 0)
  const frames     = tracker.isRunning ? tracker.totalFrames    : (displayLive?.total_frames    ?? 0)
  const sessionId  = tracker.isRunning ? (tracker.sessionId ?? '') : (displayLive?.session_id ?? '')

  const zoneColor    = ZONE_COLORS[zone] ?? ZONE_COLORS.Unknown
  const exerciseBars = displayLive ? buildExerciseBars(displayLive) : []
  const zoneSlices   = displayLive ? buildZoneSlices(displayLive)   : []
  const bpmPoints    = displayLive ? buildBpmPoints(displayLive)    : []
  const repRows      = displayLive ? buildRepRows(displayLive)      : []
  const totalReps    = displayLive
    ? Object.values(displayLive.summary.max_reps_per_exercise).reduce((a, b) => a + b, 0)
    : 0

  return (
    <main className="content">

      {/* Hidden video + canvas are always in DOM when tracker might run */}
      <video ref={videoRef} autoPlay muted playsInline style={{ display: 'none' }} />

      {/* ── Recording status bar ────────────────────────────────────────── */}
      {(tracker.isRunning || displayLive) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 18px',
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: 'var(--r-lg)', boxShadow: 'var(--sh-sm)', flexShrink: 0,
        }}>
          <span className="live-dot" style={{
            background: '#ef4444', boxShadow: '0 0 0 3px rgba(239,68,68,0.2)',
            width: 9, height: 9,
          }} />
          <span style={{ fontWeight: 700, fontSize: 'var(--t-xs)', color: '#ef4444', letterSpacing: '0.1em' }}>
            RECORDING
          </span>
          <span style={{ width: 1, height: 16, background: 'var(--card-border)', flexShrink: 0 }} />
          <span style={{
            fontSize: 'var(--t-xs)', color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {sessionId}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>Elapsed</span>
              <span style={{ fontSize: 'var(--t-sm)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-h)' }}>
                {fmtElapsed(elapsed)}
              </span>
            </div>
            <span style={{ width: 1, height: 16, background: 'var(--card-border)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>Frames</span>
              <span style={{ fontSize: 'var(--t-sm)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-h)' }}>
                {frames.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Video + metrics ─────────────────────────────────────────────── */}
      {(tracker.isRunning || displayLive) && (
        <>
          <div style={{ display: 'flex', gap: 'var(--s4)', alignItems: 'flex-start' }}>

            {/* Webcam canvas — only when tracker is running in browser */}
            {tracker.isRunning && (
              <div className="card" style={{ overflow: 'hidden', flex: '0 0 auto', width: 400 }}>
                <div className="card__head" style={{ padding: '10px 14px' }}>
                  <div className="card__head-left">
                    <div className="card__title-icon" style={{ fontSize: 13 }}>📷</div>
                    <span className="card__title" style={{ fontSize: 'var(--t-sm)' }}>Live Camera</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>BPM:</span>
                    <BpmInput value={bpm} onChange={setBpm} />
                    <button
                      className="btn btn--danger"
                      onClick={handleStop}
                      disabled={stopping}
                      style={{ minWidth: 110, fontSize: 'var(--t-xs)', padding: '5px 10px' }}
                    >
                      {stopping ? 'Saving…' : '■  Stop'}
                    </button>
                  </div>
                </div>
                <canvas
                  ref={canvasRef}
                  style={{
                    width: '100%', display: 'block',
                    borderRadius: '0 0 var(--r-lg) var(--r-lg)',
                    background: '#1a1a1a', aspectRatio: '4/3', objectFit: 'contain',
                  }}
                />
              </div>
            )}

            {/* Metric cards */}
            <div style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: tracker.isRunning ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)',
              gap: 'var(--s4)',
            }}>
              <MCard
                icon="🏃" iconClass="mcard__icon--blue"
                label="Exercise"   value={exercise}
                sub={`${Math.round(confidence * 100)}% confidence`}
              />
              <MCard
                icon="❤️" iconClass="mcard__icon--red"
                label="Heart Rate" value={String(bpm)}
                sub={displayLive ? `Avg ${displayLive.summary.avg_bpm} · Peak ${displayLive.summary.max_bpm} BPM` : undefined}
              />
              <MCard
                icon="⚡" iconClass="mcard__icon--purple"
                label="Fatigue Zone" value={zone}
                valueColor={zoneColor}
                sub="Current zone"
              />
              <MCard
                icon="🔁" iconClass="mcard__icon--green"
                label="Reps (this)" value={String(reps)}
                sub="Current exercise"
              />
              <MCard
                icon="⏱" iconClass="mcard__icon--cyan"
                label="Total Reps" value={String(totalReps)}
                sub={displayLive
                  ? `${displayLive.summary.exercises_detected.length} type${displayLive.summary.exercises_detected.length !== 1 ? 's' : ''} detected`
                  : undefined}
              />
            </div>
          </div>

          {/* Charts — only show when we have server live data */}
          {displayLive && (
            <>
              <div className="grid-2">
                <div className="card">
                  <div className="card__head">
                    <div className="card__head-left">
                      <div className="card__title-icon">🏃</div>
                      <span className="card__title">Exercise Distribution</span>
                    </div>
                    <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>
                      {exerciseBars.length} type{exerciseBars.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="card__body">
                    <ExerciseChart data={exerciseBars} />
                  </div>
                </div>

                <div className="card">
                  <div className="card__head">
                    <div className="card__head-left">
                      <div className="card__title-icon">⚡</div>
                      <span className="card__title">Fatigue Zone Breakdown</span>
                    </div>
                  </div>
                  <div className="card__body">
                    <ZonePieChart data={zoneSlices} />
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card__head">
                  <div className="card__head-left">
                    <div className="card__title-icon">❤️</div>
                    <span className="card__title">Heart Rate — Live</span>
                  </div>
                  <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>
                    Last {displayLive.bpm_history.length} readings
                  </span>
                </div>
                <div className="card__body">
                  <BpmChart data={bpmPoints} />
                </div>
              </div>

              <div className="card">
                <div className="card__head">
                  <div className="card__head-left">
                    <div className="card__title-icon">🔁</div>
                    <span className="card__title">Reps Per Exercise</span>
                  </div>
                </div>
                <RepsTable data={repRows} />
              </div>

              {/* AI insight — only after tracker has stopped (session is saved) */}
              {!tracker.isRunning && displayLive?.session_id && (
                <AiInsightCard sessionId={displayLive.session_id} />
              )}
            </>
          )}

          {/* Waiting for first server sync */}
          {tracker.isRunning && !displayLive && (
            <div className="empty" style={{ flex: 'none', padding: '24px 0' }}>
              <div className="empty__icon" style={{ fontSize: 22 }}>⏳</div>
              <div className="empty__title" style={{ fontSize: 'var(--t-base)' }}>Charts loading…</div>
              <div className="empty__text">First sync in ~1 s.</div>
            </div>
          )}
        </>
      )}

    </main>
  )
}
