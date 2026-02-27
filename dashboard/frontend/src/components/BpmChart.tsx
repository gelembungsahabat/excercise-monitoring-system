import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { BpmPoint } from '../types'
import { ZONE_COLORS } from '../types'

interface Props {
  data: BpmPoint[]
}

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface TooltipPayload {
  value: number
  payload: BpmPoint
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: number
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  const zone = d.payload.zone
  const zoneColor = ZONE_COLORS[zone] ?? ZONE_COLORS.Unknown
  return (
    <div className="custom-tooltip">
      <div className="custom-tooltip__label">{fmtTime(label ?? 0)}</div>
      <div style={{ color: zoneColor, fontWeight: 700 }}>{d.value} BPM</div>
      <div className="custom-tooltip__value">{zone}</div>
    </div>
  )
}

// Zone reference lines (approximate BPM thresholds)
const ZONE_LINES = [
  { bpm: 90,  label: 'Normal',    color: ZONE_COLORS.Normal },
  { bpm: 110, label: 'Aerobic',   color: ZONE_COLORS.Aerobic },
  { bpm: 130, label: 'Anaerobic', color: ZONE_COLORS.Anaerobic },
  { bpm: 150, label: 'Maximum',   color: ZONE_COLORS.Maximum },
]

export function BpmChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📈</div>
        <div className="empty-state__text">No BPM data recorded</div>
      </div>
    )
  }

  return (
    <div className="chart-container chart-container--tall">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="time"
            tickFormatter={fmtTime}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            unit=" bpm"
            width={56}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Zone threshold reference lines */}
          {ZONE_LINES.map(({ bpm, label, color }) => (
            <ReferenceLine
              key={label}
              y={bpm}
              stroke={color}
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: label, position: 'insideTopRight', fontSize: 10, fill: color }}
            />
          ))}

          <Line
            type="monotone"
            dataKey="bpm"
            stroke="#3c50e0"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#3c50e0', strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
