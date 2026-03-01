import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'
import type { LiveSession } from '../hooks/useLiveSession'
import { ZONE_COLORS } from '../types'

interface Props { live: LiveSession }

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

export function LiveBanner({ live }: Props) {
  const zoneColor = ZONE_COLORS[live.zone] ?? ZONE_COLORS.Unknown

  // Build sparkline data from bpm_history
  const sparkData = live.bpm_history.map((bpm, i) => ({ i, bpm }))

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      border: '1px solid rgba(60,80,224,0.35)',
      borderRadius: 'var(--r-lg)',
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      flexShrink: 0,
      boxShadow: '0 0 0 1px rgba(60,80,224,0.15), 0 4px 24px rgba(0,0,0,0.18)',
    }}>

      {/* LIVE badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span className="live-dot" style={{ background: '#ef4444', boxShadow: '0 0 0 3px rgba(239,68,68,0.25)' }} />
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
          color: '#ef4444', fontFamily: 'var(--font-mono)',
        }}>LIVE</span>
      </div>

      <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

      {/* Exercise + confidence */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--t-xs)', color: 'rgba(255,255,255,0.45)', marginBottom: 2 }}>Exercise</div>
        <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: '#fff' }}>
          {live.exercise}
          <span style={{ marginLeft: 6, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>
            {Math.round(live.confidence * 100)}%
          </span>
        </div>
      </div>

      {/* BPM */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--t-xs)', color: 'rgba(255,255,255,0.45)', marginBottom: 2 }}>BPM</div>
        <div style={{ fontSize: 'var(--t-sm)', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
          {live.bpm}
        </div>
      </div>

      {/* Zone */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--t-xs)', color: 'rgba(255,255,255,0.45)', marginBottom: 2 }}>Zone</div>
        <div style={{
          fontSize: 'var(--t-xs)', fontWeight: 700,
          color: zoneColor, letterSpacing: '0.04em',
        }}>
          {live.zone}
        </div>
      </div>

      {/* Reps */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--t-xs)', color: 'rgba(255,255,255,0.45)', marginBottom: 2 }}>Reps</div>
        <div style={{ fontSize: 'var(--t-sm)', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
          {live.reps}
        </div>
      </div>

      {/* Elapsed */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--t-xs)', color: 'rgba(255,255,255,0.45)', marginBottom: 2 }}>Elapsed</div>
        <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: '#fff', fontFamily: 'var(--font-mono)' }}>
          {fmtElapsed(live.elapsed_seconds)}
        </div>
      </div>

      {/* BPM sparkline */}
      {sparkData.length > 1 && (
        <>
          <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 80, maxWidth: 160, height: 38 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <YAxis domain={['auto', 'auto']} hide />
                <Line
                  type="monotone" dataKey="bpm"
                  stroke="#3c50e0" strokeWidth={2}
                  dot={false} isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Frames */}
      <div style={{ marginLeft: 'auto', flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Frames</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-mono)' }}>
          {live.total_frames.toLocaleString()}
        </div>
      </div>
    </div>
  )
}
