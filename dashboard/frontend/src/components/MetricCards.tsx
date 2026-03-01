import type { SessionSummary } from '../types'

interface Props { summary: SessionSummary }

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m ${Math.floor(s % 60)}s`
}

interface CardProps {
  icon: string
  iconClass: string
  label: string
  value: string
  sub?: string
}

function MCard({ icon, iconClass, label, value, sub }: CardProps) {
  return (
    <div className="mcard">
      <div className={`mcard__icon ${iconClass}`}>{icon}</div>
      <div className="mcard__body">
        <div className="mcard__label">{label}</div>
        <div className="mcard__value">{value}</div>
        {sub && <div className="mcard__sub">{sub}</div>}
      </div>
    </div>
  )
}

export function MetricCards({ summary }: Props) {
  const totalReps = Object.values(summary.max_reps_per_exercise).reduce((a, b) => a + b, 0)

  return (
    <div className="metrics-row">
      <MCard
        icon="⏱"
        iconClass="mcard__icon--blue"
        label="Duration"
        value={fmtDuration(summary.total_duration_seconds)}
      />
      <MCard
        icon="❤️"
        iconClass="mcard__icon--cyan"
        label="Avg BPM"
        value={summary.avg_bpm.toFixed(0)}
        sub={`Min ${summary.min_bpm} · Max ${summary.max_bpm}`}
      />
      <MCard
        icon="📈"
        iconClass="mcard__icon--red"
        label="Peak BPM"
        value={String(summary.max_bpm)}
      />
      <MCard
        icon="🔁"
        iconClass="mcard__icon--green"
        label="Total Reps"
        value={String(totalReps)}
        sub={`${summary.exercises_detected.length} exercise type${summary.exercises_detected.length !== 1 ? 's' : ''}`}
      />
      <MCard
        icon="🎞"
        iconClass="mcard__icon--purple"
        label="Frames"
        value={summary.total_frames.toLocaleString()}
      />
    </div>
  )
}
