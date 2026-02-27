import {
  PieChart, Pie, Cell, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import type { ZoneSlice } from '../types'
import { ZONE_COLORS } from '../types'

interface Props {
  data: ZoneSlice[]
}

interface TooltipPayload {
  name: string
  value: number
  payload: ZoneSlice
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="custom-tooltip">
      <div className="custom-tooltip__label">{d.name}</div>
      <div className="custom-tooltip__value">
        {d.value.toLocaleString()} frames · {d.payload.pct.toFixed(1)}%
      </div>
    </div>
  )
}

interface LegendPayload {
  value: string
  color?: string
}

function CustomLegend({ payload }: { payload?: LegendPayload[] }) {
  if (!payload) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', justifyContent: 'center', marginTop: 8 }}>
      {payload.map((p) => (
        <span key={p.value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748b' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          {p.value}
        </span>
      ))}
    </div>
  )
}

export function ZonePieChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">🥧</div>
        <div className="empty-state__text">No zone data</div>
      </div>
    )
  }

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="45%"
            innerRadius="38%"
            outerRadius="62%"
            paddingAngle={2}
          >
            {data.map((entry) => (
              <Cell
                key={entry.name}
                fill={ZONE_COLORS[entry.name] ?? ZONE_COLORS.Unknown}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
