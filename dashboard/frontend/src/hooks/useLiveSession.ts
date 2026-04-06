import { useEffect, useState } from 'react'

export interface LiveSession {
  status: string
  session_id: string
  start_time: string
  elapsed_seconds: number
  exercise: string
  confidence: number
  bpm: number
  zone: string
  reps: number
  bpm_history: number[]
  total_frames: number
  summary: {
    avg_bpm: number
    max_bpm: number
    exercises_detected: string[]
    exercise_frame_counts?: Record<string, number>   // added in latest session_recorder
    fatigue_zone_distribution: Record<string, number>
    max_reps_per_exercise: Record<string, number>
  }
}

export interface LiveState {
  live: LiveSession | null
  /** true once the first successful response has been received */
  apiReachable: boolean
}

/**
 * Polls /api/live every second and returns the current live session state.
 *
 * apiReachable: false  → server hasn't responded yet (or is down)
 * apiReachable: true, live: null  → server is up but no session is recording
 * apiReachable: true, live: <data> → session is actively recording
 *
 * Polling is used instead of SSE because Vite's dev proxy (http-proxy) buffers
 * streaming responses, so EventSource events would never reach the browser.
 */
export function useLiveSession(): LiveState {
  const [live,         setLive]         = useState<LiveSession | null>(null)
  const [apiReachable, setApiReachable] = useState(false)

  useEffect(() => {
    let active = true

    const poll = async () => {
      try {
        const res = await fetch('/api/live')
        if (!res.ok || !active) return
        const data: LiveSession = await res.json()
        if (active) {
          setApiReachable(true)
          setLive(data.status === 'active' ? data : null)
        }
      } catch {
        // Server unreachable — don't flip apiReachable back to false once it was true
        // (avoids flickering during momentary network hiccups)
      }
    }

    poll()
    const id = setInterval(poll, 1000)
    return () => { active = false; clearInterval(id) }
  }, [])

  return { live, apiReachable }
}
