import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { BpmPoint } from '../types'
import { ZONE_COLORS } from '../types'

interface Props { data: BpmPoint[] }

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

interface TTPayload { value: number; payload: BpmPoint }
interface TTProps { active?: boolean; payload?: TTPayload[]; label?: number }

function Tooltip_({ active, payload, label }: TTProps) {
  if (!active || !payload?.length) return null
  const pt    = payload[0].payload
  const color = ZONE_COLORS[pt.zone] ?? ZONE_COLORS.Unknown
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{fmtTime(label ?? 0)}</div>
      <div className="chart-tooltip__value" style={{ color }}>{pt.bpm} BPM</div>
      <div className="chart-tooltip__sub">{pt.zone}</div>
    </div>
  )
}

// Zone threshold reference lines
const REFS = [
  { y: 90,  label: 'Rest',      color: ZONE_COLORS.Normal },
  { y: 110, label: 'Aerobic',   color: ZONE_COLORS.Aerobic },
  { y: 130, label: 'Anaerobic', color: ZONE_COLORS.Anaerobic },
  { y: 150, label: 'Max',       color: ZONE_COLORS.Maximum },
]

/**
 * Compute a Y domain that always has a non-zero range.
 * When min === max (e.g. HR monitor holds constant 120 bpm),
 * D3's linear scale degenerates and produces NaN positions → invisible chart.
 */
function safeDomain(pts: BpmPoint[]): [number, number] {
  const values = pts.map((d) => d.bpm)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  // Ensure at least a 20 bpm window so the line is never at the edge
  const pad = lo === hi ? 20 : Math.max(5, (hi - lo) * 0.15)
  return [Math.max(30, Math.floor(lo - pad)), Math.ceil(hi + pad)]
}

export function BpmChart({ data }: Props) {
  // Only plot frames that carry a real HR reading
  const pts = data.filter((d) => d.bpm > 0)

  if (!pts.length) return (
    <div className="empty" style={{ padding: 'var(--s8)' }}>
      <div className="empty__icon">📈</div>
      <div className="empty__text">No heart rate data recorded</div>
    </div>
  )

  const domain = safeDomain(pts)

  return (
    <div className="chart-wrap chart-wrap--tall">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={pts} margin={{ top: 10, right: 24, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="bpmGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3c50e0" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#3c50e0" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />

          <XAxis
            dataKey="time" tickFormatter={fmtTime}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false} tickLine={false}
            interval="preserveStartEnd"
          />

          <YAxis
            domain={domain}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false} tickLine={false}
            unit=" bpm" width={58}
          />

          <Tooltip content={<Tooltip_ />} />

          {REFS.map(({ y, label, color }) => (
            <ReferenceLine
              key={label} y={y}
              stroke={color} strokeDasharray="4 3" strokeOpacity={0.6}
              label={label}
            />
          ))}

          <Area
            type="monotone" dataKey="bpm"
            stroke="#3c50e0" strokeWidth={2}
            fill="url(#bpmGrad)"
            dot={false}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: '#3c50e0', stroke: '#fff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
