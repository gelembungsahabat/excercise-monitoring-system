import {
  PieChart, Pie, Cell, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import type { ZoneSlice } from '../types'
import { ZONE_COLORS } from '../types'

interface Props { data: ZoneSlice[] }

interface TTPayload { name: string; value: number; payload: ZoneSlice }
interface TTProps { active?: boolean; payload?: TTPayload[] }

function Tooltip_({ active, payload }: TTProps) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{d.name}</div>
      <div className="chart-tooltip__value">{d.payload.pct.toFixed(1)}%</div>
      <div className="chart-tooltip__sub">{d.value.toLocaleString()} frames</div>
    </div>
  )
}

interface LegendEntry { value: string; color?: string }

function Legend_({ payload }: { payload?: LegendEntry[] }) {
  if (!payload) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', marginTop: 8 }}>
      {payload.map((p) => (
        <span key={p.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-sub)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, display: 'inline-block', flexShrink: 0 }} />
          {p.value}
        </span>
      ))}
    </div>
  )
}

export function ZonePieChart({ data }: Props) {
  if (!data.length) return (
    <div className="empty" style={{ padding: 'var(--s8)' }}>
      <div className="empty__icon">🥧</div>
      <div className="empty__text">No fatigue zone data</div>
    </div>
  )

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data} dataKey="value" nameKey="name"
            cx="50%" cy="44%"
            innerRadius="36%" outerRadius="60%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((e) => (
              <Cell key={e.name} fill={ZONE_COLORS[e.name] ?? ZONE_COLORS.Unknown} />
            ))}
          </Pie>
          <Tooltip content={<Tooltip_ />} />
          <Legend content={<Legend_ />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
