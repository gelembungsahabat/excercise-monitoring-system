import type { LiveSession } from './hooks/useLiveSession'
import { ZONE_COLORS } from './types'
import type { ExerciseBar, ZoneSlice, BpmPoint, RepRow } from './types'
import { ExerciseChart } from './components/ExerciseChart'
import { ZonePieChart }  from './components/ZonePieChart'
import { BpmChart }      from './components/BpmChart'
import { RepsTable }     from './components/RepsTable'

// ── Data builders ─────────────────────────────────────────────────────────────

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function buildExerciseBars(live: LiveSession): ExerciseBar[] {
  // Prefer frame counts — populated from frame 1 (exercises_detected covers
  // every frame regardless of rep state). Falls back to reps if unavailable.
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

// ── Idle placeholders ─────────────────────────────────────────────────────────

function Cmd({ children }: { children: string }) {
  return (
    <code style={{
      background: 'var(--input-bg)', padding: '2px 8px',
      borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12,
      color: 'var(--brand)', border: '1px solid var(--card-border)',
    }}>
      {children}
    </code>
  )
}

function ApiDownState() {
  return (
    <div className="empty" style={{ flex: 1 }}>
      <div className="empty__icon" style={{ fontSize: 32 }}>🔌</div>
      <div className="empty__title">API server not reachable</div>
      <div className="empty__text" style={{ maxWidth: 420, lineHeight: 1.9 }}>
        Open two terminals in the project folder:<br />
        <br />
        <Cmd>python dashboard/api.py</Cmd>&nbsp; ← terminal 1<br />
        <Cmd>python src/main.py</Cmd>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ← terminal 2<br />
        <br />
        Or run both at once: <Cmd>bash start.sh</Cmd>
      </div>
    </div>
  )
}

function IdleState() {
  return (
    <div className="empty" style={{ flex: 1 }}>
      <div className="empty__icon" style={{ fontSize: 32 }}>📡</div>
      <div className="empty__title">Waiting for a session…</div>
      <div className="empty__text" style={{ maxWidth: 340, lineHeight: 1.9 }}>
        API is running. Start a workout:<br />
        <br />
        <Cmd>python src/main.py</Cmd><br />
        <br />
        Live metrics will appear here automatically.
      </div>
    </div>
  )
}

// ── Metric card ───────────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

interface Props { live: LiveSession | null; apiReachable: boolean }

export function LivePage({ live, apiReachable }: Props) {
  if (!live) return apiReachable ? <IdleState /> : <ApiDownState />

  const zoneColor    = ZONE_COLORS[live.zone] ?? ZONE_COLORS.Unknown
  const exerciseBars = buildExerciseBars(live)
  const zoneSlices   = buildZoneSlices(live)
  const bpmPoints    = buildBpmPoints(live)
  const repRows      = buildRepRows(live)
  const totalReps    = Object.values(live.summary.max_reps_per_exercise)
    .reduce((a, b) => a + b, 0)

  return (
    <main className="content">

      {/* ── Recording status bar ─────────────────────────────────────────── */}
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
          {live.session_id}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>Elapsed</span>
            <span style={{ fontSize: 'var(--t-sm)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-h)' }}>
              {fmtElapsed(live.elapsed_seconds)}
            </span>
          </div>
          <span style={{ width: 1, height: 16, background: 'var(--card-border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>Frames</span>
            <span style={{ fontSize: 'var(--t-sm)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-h)' }}>
              {live.total_frames.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* ── Metric cards (matches Sessions layout) ───────────────────────── */}
      <div className="metrics-row">
        <MCard
          icon="🏃" iconClass="mcard__icon--blue"
          label="Exercise"   value={live.exercise}
          sub={`${Math.round(live.confidence * 100)}% confidence`}
        />
        <MCard
          icon="❤️" iconClass="mcard__icon--red"
          label="Heart Rate" value={String(live.bpm)}
          sub={`Avg ${live.summary.avg_bpm} · Peak ${live.summary.max_bpm} BPM`}
        />
        <MCard
          icon="⚡" iconClass="mcard__icon--purple"
          label="Fatigue Zone" value={live.zone}
          valueColor={zoneColor}
          sub="Current zone"
        />
        <MCard
          icon="🔁" iconClass="mcard__icon--green"
          label="Reps (this)" value={String(live.reps)}
          sub="Current exercise"
        />
        <MCard
          icon="⏱" iconClass="mcard__icon--cyan"
          label="Total Reps" value={String(totalReps)}
          sub={`${live.summary.exercises_detected.length} type${live.summary.exercises_detected.length !== 1 ? 's' : ''} detected`}
        />
      </div>

      {/* ── Exercise distribution + Zone pie ─────────────────────────────── */}
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

      {/* ── Heart rate over time ──────────────────────────────────────────── */}
      <div className="card">
        <div className="card__head">
          <div className="card__head-left">
            <div className="card__title-icon">❤️</div>
            <span className="card__title">Heart Rate — Live</span>
          </div>
          <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>
            Last {live.bpm_history.length} reading{live.bpm_history.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="card__body">
          <BpmChart data={bpmPoints} />
        </div>
      </div>

      {/* ── Reps table ───────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card__head">
          <div className="card__head-left">
            <div className="card__title-icon">🔁</div>
            <span className="card__title">Reps Per Exercise</span>
          </div>
        </div>
        <RepsTable data={repRows} />
      </div>

    </main>
  )
}
