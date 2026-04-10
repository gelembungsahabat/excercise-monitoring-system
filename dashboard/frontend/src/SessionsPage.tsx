import { ClipboardList, AlertTriangle, BarChart2, Zap, Heart, RotateCcw } from 'lucide-react'
import type { Session, ExerciseBar, ZoneSlice, BpmPoint, RepRow } from './types'
import { Header } from './components/Header'
import { MetricCards } from './components/MetricCards'
import { ExerciseChart } from './components/ExerciseChart'
import { ZonePieChart } from './components/ZonePieChart'
import { BpmChart } from './components/BpmChart'
import { RepsTable } from './components/RepsTable'
import { AiInsightCard } from './components/AiInsightCard'

interface Props {
  session:      Session | null
  loading:      boolean
  error:        string | null
  activeId:     string | null
  exerciseBars: ExerciseBar[]
  zoneSlices:   ZoneSlice[]
  bpmPoints:    BpmPoint[]
  repRows:      RepRow[]
  onRetry:  () => void
  onExport: () => void
}

export function SessionsPage({
  session, loading, error, activeId,
  exerciseBars, zoneSlices, bpmPoints, repRows,
  onRetry, onExport,
}: Props) {
  return (
    <>
      <Header session={session} onExport={onExport} />

      <main className="content">

        {/* ── No session selected ── */}
        {!activeId && !loading && (
          <div className="empty">
            <div className="empty__icon"><ClipboardList size={32} /></div>
            <div className="empty__title">No session selected</div>
            <div className="empty__text">
              Pick a session from the sidebar to view its data.
            </div>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="empty">
            <div className="spinner" />
            <div className="empty__text">Loading session…</div>
          </div>
        )}

        {/* ── Error ── */}
        {error && !loading && (
          <div className="empty">
            <div className="empty__icon"><AlertTriangle size={32} /></div>
            <div className="empty__title">Failed to load session</div>
            <div className="empty__text">{error}</div>
            <button className="btn btn--primary" onClick={onRetry}>Retry</button>
          </div>
        )}

        {/* ── Session content ── */}
        {session && !loading && !error && (
          <>
            <MetricCards summary={session.summary} />

            {/* Exercise + Zone charts */}
            <div className="grid-2">
              <div className="card">
                <div className="card__head">
                  <div className="card__head-left">
                    <div className="card__title-icon"><BarChart2 size={14} /></div>
                    <span className="card__title">Exercise Distribution</span>
                  </div>
                </div>
                <div className="card__body">
                  <ExerciseChart data={exerciseBars} />
                </div>
              </div>

              <div className="card">
                <div className="card__head">
                  <div className="card__head-left">
                    <div className="card__title-icon"><Zap size={14} /></div>
                    <span className="card__title">Fatigue Zone Breakdown</span>
                  </div>
                </div>
                <div className="card__body">
                  <ZonePieChart data={zoneSlices} />
                </div>
              </div>
            </div>

            {/* BPM timeline */}
            <div className="card">
              <div className="card__head">
                <div className="card__head-left">
                  <div className="card__title-icon"><Heart size={14} /></div>
                  <span className="card__title">Heart Rate Over Time</span>
                </div>
              </div>
              <div className="card__body">
                <BpmChart data={bpmPoints} />
              </div>
            </div>

            {/* Reps table */}
            <div className="card">
              <div className="card__head">
                <div className="card__head-left">
                  <div className="card__title-icon"><RotateCcw size={14} /></div>
                  <span className="card__title">Reps Per Exercise</span>
                </div>
              </div>
              <RepsTable data={repRows} />
            </div>

            {/* AI coaching insight */}
            <AiInsightCard sessionId={session.session_id} />
          </>
        )}
      </main>
    </>
  )
}
