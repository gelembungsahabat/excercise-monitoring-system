import { RotateCcw } from 'lucide-react'
import type { RepRow } from '../types'

interface Props { data: RepRow[] }

export function RepsTable({ data }: Props) {
  // Only show exercises where at least 1 rep was counted
  const rows = [...data]
    .filter((r) => r.reps > 0)
    .sort((a, b) => b.reps - a.reps)

  if (!rows.length) return (
    <div className="empty" style={{ padding: 'var(--s6)' }}>
      <div className="empty__icon"><RotateCcw size={24} /></div>
      <div className="empty__text">No reps counted this session</div>
    </div>
  )

  const max = rows[0].reps

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Exercise</th>
            <th>Progress</th>
            <th style={{ textAlign: 'right' }}>Reps</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.exercise}>
              <td className="td-rank">{i + 1}</td>
              <td className="td-name">{row.exercise}</td>
              <td style={{ width: '40%' }}>
                <div style={{ background: 'var(--input-bg)', borderRadius: 'var(--r-full)', height: 6, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${(row.reps / max) * 100}%`,
                    background: 'var(--brand)',
                    borderRadius: 'var(--r-full)',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </td>
              <td className="td-value">{row.reps}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
