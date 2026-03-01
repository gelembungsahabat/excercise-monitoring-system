import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import type { LiveSession } from './hooks/useLiveSession'
import { ZONE_COLORS } from './types'

interface Props { live: LiveSession | null; apiReachable: boolean }

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

// ── Zone progress bar ───────────────────────────────────────────────────────

function ZoneBar({ zone, count, total }: { zone: string; count: number; total: number }) {
  const color = ZONE_COLORS[zone] ?? ZONE_COLORS.Unknown
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--t-xs)', fontWeight: 700, color }}>{zone}</span>
        <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--input-bg)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: color,
          borderRadius: 'var(--r-full)',
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  )
}

// ── Code chip helper ─────────────────────────────────────────────────────────

function Cmd({ children }: { children: string }) {
  return (
    <code style={{
      background: 'var(--input-bg)', padding: '2px 8px',
      borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12,
      color: 'var(--brand)',
    }}>
      {children}
    </code>
  )
}

// ── Idle placeholders ────────────────────────────────────────────────────────

function ApiDownState() {
  return (
    <div className="empty" style={{ flex: 1 }}>
      <div className="empty__icon" style={{ fontSize: 32 }}>🔌</div>
      <div className="empty__title">API server not reachable</div>
      <div className="empty__text" style={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.8 }}>
        Start the API server first, then run the workout tracker:<br />
        <br />
        <Cmd>cd /path/to/excercise-monitoring-system</Cmd><br />
        <br />
        <Cmd>python dashboard/api.py</Cmd>&nbsp; (terminal 1)<br />
        <Cmd>python src/main.py</Cmd>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (terminal 2)<br />
        <br />
        Or use the helper script: <Cmd>bash start.sh</Cmd>
      </div>
    </div>
  )
}

function IdleState() {
  return (
    <div className="empty" style={{ flex: 1 }}>
      <div className="empty__icon" style={{ fontSize: 32 }}>📡</div>
      <div className="empty__title">No active session</div>
      <div className="empty__text" style={{ maxWidth: 380, textAlign: 'center', lineHeight: 1.8 }}>
        API server is running. Start a workout session:<br />
        <br />
        <Cmd>python src/main.py</Cmd><br />
        <br />
        Live metrics will appear here automatically.
      </div>
    </div>
  )
}

// ── Metric card ─────────────────────────────────────────────────────────────

function LiveCard({
  icon, iconClass, label, value, sub, valueColor,
}: {
  icon: string; iconClass: string; label: string
  value: string; sub?: string; valueColor?: string
}) {
  return (
    <div className="mcard">
      <div className={`mcard__icon ${iconClass}`}>{icon}</div>
      <div className="mcard__body">
        <div className="mcard__label">{label}</div>
        <div className="mcard__value" style={{ color: valueColor, fontSize: 'var(--t-xl)', letterSpacing: '-0.3px' }}>
          {value}
        </div>
        {sub && <div className="mcard__sub">{sub}</div>}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function LivePage({ live, apiReachable }: Props) {
  if (!live) return apiReachable ? <IdleState /> : <ApiDownState />

  const zoneColor = ZONE_COLORS[live.zone] ?? ZONE_COLORS.Unknown

  // BPM history → time-series for the chart
  // bpm_history[0] is oldest, last entry is current
  const bpmPts = live.bpm_history.map((bpm, i) => {
    const offsetFromNow = live.bpm_history.length - 1 - i
    const t = Math.max(0, Math.round(live.elapsed_seconds - offsetFromNow))
    return { t, bpm }
  })

  // Zone distribution
  const totalFrames = live.total_frames || 1
  const zoneDist = Object.entries(live.summary.fatigue_zone_distribution)
    .sort((a, b) => b[1] - a[1])

  // Exercises + reps
  const exerciseReps = Object.entries(live.summary.max_reps_per_exercise)
    .sort((a, b) => b[1] - a[1])

  return (
    <main className="content">

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 18px',
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: 'var(--r-lg)', boxShadow: 'var(--sh-sm)',
      }}>
        <span className="live-dot" style={{ background: '#ef4444', boxShadow: '0 0 0 3px rgba(239,68,68,0.2)', width: 9, height: 9 }} />
        <span style={{ fontWeight: 700, fontSize: 'var(--t-xs)', color: '#ef4444', letterSpacing: '0.1em' }}>
          RECORDING
        </span>
        <span style={{ width: 1, height: 16, background: 'var(--card-border)', flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

      {/* ── Metric cards ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s4)' }}>
        <LiveCard
          icon="🏃" iconClass="mcard__icon--blue"
          label="Exercise" value={live.exercise}
          sub={`${Math.round(live.confidence * 100)}% confidence`}
        />
        <LiveCard
          icon="❤️" iconClass="mcard__icon--red"
          label="Heart Rate" value={`${live.bpm}`}
          sub="BPM"
        />
        <LiveCard
          icon="⚡" iconClass="mcard__icon--purple"
          label="Fatigue Zone" value={live.zone}
          valueColor={zoneColor}
          sub="Current zone"
        />
        <LiveCard
          icon="🔁" iconClass="mcard__icon--green"
          label="Reps" value={String(live.reps)}
          sub="This exercise"
        />
      </div>

      {/* ── Live BPM chart ─────────────────────────────────────────────── */}
      <div className="card">
        <div className="card__head">
          <div className="card__head-left">
            <div className="card__title-icon">❤️</div>
            <span className="card__title">Heart Rate — Live</span>
          </div>
          <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>
            Last {live.bpm_history.length} readings
          </span>
        </div>
        <div className="card__body">
          {bpmPts.length < 2 ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 'var(--t-sm)' }}>
              Collecting data…
            </div>
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={bpmPts} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="liveGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.20} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="t" tickFormatter={fmtTime}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false} tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false} tickLine={false}
                    unit=" bpm" width={58}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1e2a3a', border: 'none', borderRadius: 8, fontSize: 12, padding: '6px 10px' }}
                    labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                    itemStyle={{ color: '#ef4444', fontWeight: 700 }}
                    formatter={(v: number) => [`${v} BPM`, '']}
                    labelFormatter={(v) => fmtTime(Number(v))}
                  />
                  <Area
                    type="monotone" dataKey="bpm"
                    stroke="#ef4444" strokeWidth={2}
                    fill="url(#liveGrad)"
                    dot={false} isAnimationActive={false}
                    activeDot={{ r: 4, fill: '#ef4444', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Zone + Exercises ────────────────────────────────────────────── */}
      <div className="grid-2">

        {/* Zone distribution */}
        <div className="card">
          <div className="card__head">
            <div className="card__head-left">
              <div className="card__title-icon">⚡</div>
              <span className="card__title">Fatigue Zone Distribution</span>
            </div>
          </div>
          <div className="card__body">
            {zoneDist.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 'var(--t-sm)', textAlign: 'center', padding: '20px 0' }}>
                No zone data yet
              </div>
            ) : (
              zoneDist.map(([zone, count]) => (
                <ZoneBar key={zone} zone={zone} count={count} total={totalFrames} />
              ))
            )}
          </div>
        </div>

        {/* Exercises detected */}
        <div className="card">
          <div className="card__head">
            <div className="card__head-left">
              <div className="card__title-icon">🏃</div>
              <span className="card__title">Exercises Detected</span>
            </div>
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>
              {exerciseReps.length} type{exerciseReps.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            {exerciseReps.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 'var(--t-sm)', textAlign: 'center', padding: '20px 0' }}>
                No exercises detected yet
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Exercise</th>
                      <th style={{ textAlign: 'right' }}>Max Reps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exerciseReps.map(([ex, reps], i) => (
                      <tr key={ex}>
                        <td className="td-rank">{i + 1}</td>
                        <td className="td-name">{ex}</td>
                        <td className="td-value">{reps > 0 ? reps : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>
    </main>
  )
}
