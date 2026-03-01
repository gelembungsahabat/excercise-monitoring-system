import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import type { ExerciseBar } from '../types'

interface Props { data: ExerciseBar[] }

const COLORS = ['#3c50e0','#6478f0','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6']

interface TTPayload { value: number }
interface TTProps { active?: boolean; payload?: TTPayload[]; label?: string }

function Tooltip_({ active, payload, label }: TTProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{label}</div>
      <div className="chart-tooltip__value">{payload[0].value.toLocaleString()} frames</div>
    </div>
  )
}

export function ExerciseChart({ data }: Props) {
  if (!data.length) return (
    <div className="empty" style={{ padding: 'var(--s8)' }}>
      <div className="empty__icon">📊</div>
      <div className="empty__text">No exercise data recorded</div>
    </div>
  )

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            type="category" dataKey="exercise" width={96}
            tick={{ fontSize: 12, fill: '#4b5563', fontWeight: 500 }}
            axisLine={false} tickLine={false}
          />
          <Tooltip content={<Tooltip_ />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="frames" radius={[0, 5, 5, 0]} maxBarSize={26}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
