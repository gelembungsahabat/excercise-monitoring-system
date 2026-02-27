import type { RepRow } from '../types'

interface Props {
  data: RepRow[]
}

export function RepsTable({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 'var(--sp-6)' }}>
        <div className="empty-state__text">No rep data recorded</div>
      </div>
    )
  }

  const sorted = [...data].sort((a, b) => b.reps - a.reps)

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th style={{ width: 36 }}>#</th>
          <th>Exercise</th>
          <th style={{ textAlign: 'right' }}>Max Reps</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, i) => (
          <tr key={row.exercise}>
            <td className="data-table__rank">{i + 1}</td>
            <td>{row.exercise}</td>
            <td className="data-table__reps" style={{ textAlign: 'right' }}>
              {row.reps}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
