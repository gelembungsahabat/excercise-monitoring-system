/**
 * useBrowserTracker
 * -----------------
 * Orchestrates the browser-side exercise tracking pipeline:
 *   getUserMedia → MediaPipe Pose → exercise classify → rep count → session save
 *
 * Storage strategy (memory-efficient):
 *   - Per RAF frame: update running aggregates only (O(1), no array growth)
 *   - Per second:    push one lightweight BPM sample + post live snapshot
 *   - On stop:       build session from aggregates + samples (~1 row/sec)
 *
 * A 60-minute session produces ~3,600 samples × ~40 bytes = ~144 KB,
 * vs the old approach of ~108,000 frames × ~200 bytes = ~21 MB.
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from '@mediapipe/tasks-vision'
import {
  computeAngles,
  classifyExercise,
  primaryAngle,
  updateRep,
  EXERCISES,
} from './useExerciseDetector'
import type { JointAngles, RepState } from './useExerciseDetector'
import { api } from '../api'

// ── Types ────────────────────────────────────────────────────────────────────

export interface BrowserTrackerState {
  isRunning:      boolean
  isLoading:      boolean
  error:          string | null
  exercise:       string
  confidence:     number
  bpm:            number
  zone:           string
  reps:           number
  elapsedSeconds: number
  totalFrames:    number
  sessionId:      string | null
}

/** One lightweight sample stored per second — used for the BPM chart. */
interface BpmSample {
  duration_seconds: number
  bpm:              number
  fatigue_zone:     string
}

// ── CDN URLs ─────────────────────────────────────────────────────────────────

const MEDIAPIPE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'

const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSessionId(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `session_` +
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function ruleBpmZone(bpm: number): string {
  if (bpm <= 90)  return 'Recovery'
  if (bpm <= 109) return 'Normal'
  if (bpm <= 129) return 'Aerobic'
  if (bpm <= 149) return 'Anaerobic'
  return 'Maximum'
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBrowserTracker(
  videoRef:  React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  // ── React state (UI-facing) ───────────────────────────────────────────────
  const [state, setState] = useState<BrowserTrackerState>({
    isRunning:      false,
    isLoading:      false,
    error:          null,
    exercise:       'Standing',
    confidence:     0,
    bpm:            120,
    zone:           'Normal',
    reps:           0,
    elapsedSeconds: 0,
    totalFrames:    0,
    sessionId:      null,
  })

  // ── MediaPipe refs ────────────────────────────────────────────────────────
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const visionRef     = useRef<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null>(null)

  // ── Camera / loop refs ────────────────────────────────────────────────────
  const streamRef       = useRef<MediaStream | null>(null)
  const rafRef          = useRef<number | null>(null)
  const liveTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopFlagRef     = useRef(false)
  const lastVideoTsRef  = useRef(0)
  const frameCountRef   = useRef(0)   // total RAF frames processed (for UI)

  // ── Session identity ──────────────────────────────────────────────────────
  const sessionIdRef  = useRef('')
  const startTimeRef  = useRef(0)

  // ── Current-frame state refs (updated every RAF, read in timer/stop) ──────
  const bpmRef          = useRef(120)
  const zoneRef         = useRef('Normal')
  const curExerciseRef  = useRef('Standing')
  const curConfRef      = useRef(0)
  const curElapsedRef   = useRef(0)

  // ── Running aggregates (O(1) update per frame, no array growth) ───────────
  const zoneCountsRef = useRef<Record<string, number>>({})   // zone → frame count
  const exCountsRef   = useRef<Record<string, number>>({})   // exercise → frame count
  const bpmSumRef     = useRef(0)
  const bpmCountRef   = useRef(0)
  const bpmMaxRef     = useRef(0)
  const bpmMinRef     = useRef(Infinity)

  // ── Rep state ─────────────────────────────────────────────────────────────
  const repStatesRef = useRef<Record<string, RepState>>(
    Object.fromEntries(EXERCISES.map(ex => [ex, { count: 0, stage: 'up' as const }]))
  )

  // ── Per-second BPM samples (for BPM chart in saved session) ──────────────
  // One sample per second → 3,600 samples/hour vs ~108,000 frames/hour.
  const bpmSamplesRef = useRef<BpmSample[]>([])

  // ── Load MediaPipe ────────────────────────────────────────────────────────
  // FilesetResolver (WASM) is cached after first load.
  // PoseLandmarker is always recreated fresh so its internal graph state
  // (free_memory stream) never carries over from a previous session.
  const initLandmarker = useCallback(async () => {
    if (!visionRef.current) {
      visionRef.current = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL)
    }
    landmarkerRef.current = await PoseLandmarker.createFromOptions(visionRef.current, {
      baseOptions: {
        modelAssetPath: POSE_MODEL_URL,
        // CPU delegate avoids the GPU free_memory stream timestamp-mismatch bug.
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    })
  }, [])

  // ── BPM override (called by UI) ───────────────────────────────────────────
  const setBpm = useCallback((bpm: number) => {
    bpmRef.current = bpm
    setState(prev => ({ ...prev, bpm }))
  }, [])

  // ── Fetch zone from API, fallback to rule-based ───────────────────────────
  const fetchZone = useCallback(async (bpm: number) => {
    try {
      const { zone } = await api.classifyBpm(bpm)
      zoneRef.current = zone
    } catch {
      zoneRef.current = ruleBpmZone(bpm)
    }
  }, [])

  // ── Per-second tick: sample BPM + post live snapshot ─────────────────────
  // Reads from aggregates refs — O(1), no loops over frame arrays.
  const onSecondTick = useCallback(() => {
    const elapsed  = curElapsedRef.current
    const bpm      = bpmRef.current
    const zone     = zoneRef.current
    const exercise = curExerciseRef.current

    // Push one lightweight sample for the BPM chart
    bpmSamplesRef.current.push({ duration_seconds: elapsed, bpm, fatigue_zone: zone })

    // Build live payload from running aggregates (no loops)
    const bpmCount = bpmCountRef.current || 1
    const repCounts = Object.fromEntries(
      Object.entries(repStatesRef.current).map(([ex, s]) => [ex, s.count])
    )
    // last 60 BPM samples for the sparkline
    const bpmHistory = bpmSamplesRef.current.slice(-60).map(s => s.bpm)

    const payload = {
      status:          'active',
      session_id:      sessionIdRef.current,
      start_time:      new Date(startTimeRef.current).toISOString(),
      elapsed_seconds: Math.round(elapsed),
      exercise,
      confidence:      curConfRef.current,
      bpm,
      zone,
      reps:            repStatesRef.current[exercise]?.count ?? 0,
      bpm_history:     bpmHistory,
      total_frames:    frameCountRef.current,
      summary: {
        avg_bpm: Math.round(bpmSumRef.current / bpmCount),
        max_bpm: bpmMaxRef.current,
        exercises_detected: Object.keys(exCountsRef.current).filter(ex => ex !== 'Standing'),
        exercise_frame_counts:     { ...exCountsRef.current },
        fatigue_zone_distribution: { ...zoneCountsRef.current },
        max_reps_per_exercise:     repCounts,
      },
    }

    api.postLive(payload).catch(() => {})
  }, [])

  // ── Detection loop (runs every animation frame) ───────────────────────────
  const loopFnRef = useRef<() => void>(() => {})

  loopFnRef.current = () => {
    if (stopFlagRef.current) return

    const video  = videoRef.current
    const canvas = canvasRef.current
    const lm     = landmarkerRef.current

    if (!video || !canvas || !lm || video.readyState < 2 || video.videoWidth === 0) {
      rafRef.current = requestAnimationFrame(() => loopFnRef.current())
      return
    }

    // Skip frames where video.currentTime hasn't advanced — MediaPipe uses
    // video.currentTime internally and crashes on duplicate/decreasing timestamps.
    const videoTs = Math.floor(video.currentTime * 1000)
    if (videoTs === 0 || videoTs <= lastVideoTsRef.current) {
      rafRef.current = requestAnimationFrame(() => loopFnRef.current())
      return
    }
    lastVideoTsRef.current = videoTs

    const now = Date.now()

    // Draw video frame onto canvas for the overlay
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)

    let results: ReturnType<typeof lm.detectForVideo>
    try {
      results = lm.detectForVideo(video, videoTs)
    } catch {
      rafRef.current = requestAnimationFrame(() => loopFnRef.current())
      return
    }

    let exercise   = 'Standing'
    let confidence = 0

    if (results.landmarks.length > 0) {
      const landmarks  = results.landmarks[0]
      const angles: JointAngles = computeAngles(landmarks)
      ;[exercise, confidence] = classifyExercise(angles)

      // Update rep counter
      const angle = primaryAngle(exercise, angles)
      repStatesRef.current[exercise] = updateRep(
        repStatesRef.current[exercise] ?? { count: 0, stage: 'up' },
        exercise,
        angle,
      )

      // Draw skeleton (skip face landmarks 0–10)
      const drawUtils = new DrawingUtils(ctx)
      const bodyConns = PoseLandmarker.POSE_CONNECTIONS.filter(
        c => c.start > 10 && c.end > 10,
      )
      drawUtils.drawConnectors(landmarks, bodyConns, { color: 'rgba(255,255,255,0.7)', lineWidth: 2 })
      drawUtils.drawLandmarks(
        landmarks.filter((_, i) => i > 10),
        { radius: 4, color: '#00ff41', fillColor: '#00ff41' },
      )
    }

    // ── Update running aggregates (O(1)) ──────────────────────────────────
    const elapsed = (now - startTimeRef.current) / 1000
    const bpm     = bpmRef.current
    const zone    = zoneRef.current

    zoneCountsRef.current[zone]      = (zoneCountsRef.current[zone]      ?? 0) + 1
    exCountsRef.current[exercise]    = (exCountsRef.current[exercise]    ?? 0) + 1
    bpmSumRef.current  += bpm
    bpmCountRef.current++
    if (bpm > bpmMaxRef.current)              bpmMaxRef.current = bpm
    if (bpm < bpmMinRef.current)              bpmMinRef.current = bpm

    curExerciseRef.current = exercise
    curConfRef.current     = confidence
    curElapsedRef.current  = elapsed
    frameCountRef.current++

    // Update React state every 5 frames
    if (frameCountRef.current % 5 === 0) {
      setState(prev => ({
        ...prev,
        exercise,
        confidence,
        reps:           repStatesRef.current[exercise]?.count ?? 0,
        elapsedSeconds: Math.round(elapsed),
        totalFrames:    frameCountRef.current,
        bpm,
        zone,
      }))
    }

    rafRef.current = requestAnimationFrame(() => loopFnRef.current())
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  const start = useCallback(async (initialBpm = 120) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    try {
      await initLandmarker()

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      })
      streamRef.current = stream

      const video = videoRef.current!
      video.srcObject = stream
      await new Promise<void>(resolve => { video.onloadedmetadata = () => resolve() })
      await video.play()

      // Reset all session state
      const sessionId = makeSessionId()
      sessionIdRef.current  = sessionId
      startTimeRef.current  = Date.now()
      frameCountRef.current = 0
      lastVideoTsRef.current = 0
      bpmRef.current        = initialBpm
      zoneRef.current       = 'Normal'
      stopFlagRef.current   = false
      curExerciseRef.current = 'Standing'
      curConfRef.current    = 0
      curElapsedRef.current = 0

      // Reset aggregates
      zoneCountsRef.current = {}
      exCountsRef.current   = {}
      bpmSumRef.current     = 0
      bpmCountRef.current   = 0
      bpmMaxRef.current     = 0
      bpmMinRef.current     = Infinity
      bpmSamplesRef.current = []
      repStatesRef.current  = Object.fromEntries(
        EXERCISES.map(ex => [ex, { count: 0, stage: 'up' as const }])
      )

      await fetchZone(initialBpm)

      rafRef.current = requestAnimationFrame(() => loopFnRef.current())

      // Per-second: fetch zone + push BPM sample + post live snapshot
      liveTimerRef.current = setInterval(() => {
        fetchZone(bpmRef.current)
        onSecondTick()
      }, 1000)

      setState(prev => ({
        ...prev,
        isRunning:      true,
        isLoading:      false,
        sessionId,
        bpm:            initialBpm,
        zone:           'Normal',
        elapsedSeconds: 0,
        totalFrames:    0,
        exercise:       'Standing',
        confidence:     0,
        reps:           0,
        error:          null,
      }))
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to start camera',
      }))
    }
  }, [initLandmarker, videoRef, fetchZone, onSecondTick])

  // ── Stop ──────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    stopFlagRef.current = true

    if (rafRef.current)       { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null }

    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    try { landmarkerRef.current?.close() } catch { /* ignore */ }
    landmarkerRef.current = null

    // Flip UI to stopped immediately — don't block on the network save
    setState(prev => ({ ...prev, isRunning: false, sessionId: null }))
    api.postLive({ status: 'idle' }).catch(() => {})

    // ── Build compact session payload from aggregates + BPM samples ────────
    const samples = bpmSamplesRef.current
    if (samples.length === 0) return

    const startIso = new Date(startTimeRef.current).toISOString()
    const endIso   = new Date().toISOString()
    const duration = (Date.now() - startTimeRef.current) / 1000

    const bpmCount  = bpmCountRef.current || 1
    const exFrames  = { ...exCountsRef.current }
    const zoneDist  = { ...zoneCountsRef.current }
    const totalSamples = samples.length || 1

    const maxReps: Record<string, number> = {}
    for (const [ex, st] of Object.entries(repStatesRef.current)) {
      if (st.count > 0) maxReps[ex] = st.count
    }

    const zonePct: Record<string, number> = {}
    for (const [z, c] of Object.entries(zoneDist)) {
      zonePct[z] = Math.round((c / (frameCountRef.current || 1)) * 1000) / 10
    }

    const session = {
      session_id:       sessionIdRef.current,
      start_time:       startIso,
      end_time:         endIso,
      duration_seconds: Math.round(duration),
      // "frames" field uses the per-second samples — the SessionsPage BPM chart
      // downsamples to 300 points anyway, so per-second resolution is plenty.
      frames: samples,
      summary: {
        session_id:                sessionIdRef.current,
        start_time:                startIso,
        end_time:                  endIso,
        total_duration_seconds:    Math.round(duration),
        exercises_detected:        Object.keys(exFrames).filter(
          ex => ex !== 'Standing' && (exFrames[ex] ?? 0) > 5
        ),
        exercise_frame_counts:     exFrames,
        max_reps_per_exercise:     maxReps,
        fatigue_zone_distribution: zoneDist,
        fatigue_zone_pct:          zonePct,
        avg_bpm:     Math.round(bpmSumRef.current / bpmCount),
        max_bpm:     bpmMaxRef.current,
        min_bpm:     bpmMinRef.current === Infinity ? 0 : bpmMinRef.current,
        total_frames: totalSamples,
      },
    }

    api.saveSession(session).catch(e => console.error('Failed to save session:', e))
  }, [])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopFlagRef.current = true
      if (rafRef.current)       cancelAnimationFrame(rafRef.current)
      if (liveTimerRef.current) clearInterval(liveTimerRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      try { landmarkerRef.current?.close() } catch { /* ignore */ }
    }
  }, [])

  return { state, start, stop, setBpm }
}
