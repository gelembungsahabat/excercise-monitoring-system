import type { SessionSummary } from '../types'

interface Props {
  summary: SessionSummary
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m ${sec}s`
}

interface MetricCardProps {
  icon: string
  label: string
  value: string
  sub?: string
  modifier: string
}

function MetricCard({ icon, label, value, sub, modifier }: MetricCardProps) {
  return (
    <div className={`metric-card metric-card--${modifier}`}>
      <div className="metric-card__icon">{icon}</div>
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      {sub && <div className="metric-card__sub">{sub}</div>}
    </div>
  )
}

export function MetricCards({ summary }: Props) {
  const totalReps = Object.values(summary.max_reps_per_exercise).reduce((a, b) => a + b, 0)

  return (
    <div className="metrics-grid">
      <MetricCard
        icon="⏱"
        label="Duration"
        value={fmtDuration(summary.total_duration_seconds)}
        modifier="duration"
      />
      <MetricCard
        icon="❤️"
        label="Avg BPM"
        value={summary.avg_bpm.toFixed(0)}
        sub={`Min ${summary.min_bpm} · Max ${summary.max_bpm}`}
        modifier="bpm-avg"
      />
      <MetricCard
        icon="📈"
        label="Max BPM"
        value={String(summary.max_bpm)}
        modifier="bpm-max"
      />
      <MetricCard
        icon="🔁"
        label="Total Reps"
        value={String(totalReps)}
        sub={`${summary.exercises_detected.length} exercise(s)`}
        modifier="reps"
      />
      <MetricCard
        icon="🎞"
        label="Frames"
        value={summary.total_frames.toLocaleString()}
        modifier="frames"
      />
    </div>
  )
}
