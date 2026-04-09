/**
 * useBrowserTracker
 * -----------------
 * Orchestrates the browser-side exercise tracking pipeline:
 *   getUserMedia → MediaPipe Pose → exercise classify → rep count → session save
 *
 * The caller must pass refs to a <video> and a <canvas> element.
 * The video element receives the raw webcam stream (hidden).
 * The canvas element shows the annotated pose overlay.
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

interface FrameRecord {
  timestamp:        string
  session_id:       string
  exercise_type:    string
  confidence:       number
  bpm:              number
  fatigue_zone:     string
  rep_count:        number
  duration_seconds: number
  joint_angles:     JointAngles
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

function roundAngle(v: number) { return Math.round(v * 10) / 10 }

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

  // ── Refs (no render needed, always fresh in callbacks) ───────────────────
  const landmarkerRef    = useRef<PoseLandmarker | null>(null)
  const streamRef        = useRef<MediaStream | null>(null)
  const rafRef           = useRef<number | null>(null)
  const stopFlagRef      = useRef(false)
  const startTimeRef     = useRef(0)
  const framesRef        = useRef<FrameRecord[]>([])
  const repStatesRef     = useRef<Record<string, RepState>>(
    Object.fromEntries(EXERCISES.map(ex => [ex, { count: 0, stage: 'up' as const }]))
  )
  const sessionIdRef     = useRef('')
  const bpmRef           = useRef(120)
  const zoneRef          = useRef('Normal')
  const curExerciseRef   = useRef('Standing')
  const curConfRef       = useRef(0)
  const liveTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const frameCounterRef  = useRef(0)

  // ── Load MediaPipe (once, lazy) ───────────────────────────────────────────
  const initLandmarker = useCallback(async () => {
    if (landmarkerRef.current) return
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL)
    landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: POSE_MODEL_URL,
        delegate: 'GPU',
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

  // ── Build and POST live state snapshot ───────────────────────────────────
  const postLiveSnapshot = useCallback(() => {
    const frames  = framesRef.current
    const elapsed = (Date.now() - startTimeRef.current) / 1000

    const zoneDist:  Record<string, number> = {}
    const exFrames:  Record<string, number> = {}
    const bpmValues: number[] = []

    for (const f of frames) {
      zoneDist[f.fatigue_zone]  = (zoneDist[f.fatigue_zone]  ?? 0) + 1
      exFrames[f.exercise_type] = (exFrames[f.exercise_type] ?? 0) + 1
      bpmValues.push(f.bpm)
    }

    const repCounts = Object.fromEntries(
      Object.entries(repStatesRef.current).map(([ex, s]) => [ex, s.count])
    )

    const payload = {
      status:          'active',
      session_id:      sessionIdRef.current,
      start_time:      new Date(startTimeRef.current).toISOString(),
      elapsed_seconds: Math.round(elapsed),
      exercise:        curExerciseRef.current,
      confidence:      curConfRef.current,
      bpm:             bpmRef.current,
      zone:            zoneRef.current,
      reps:            repStatesRef.current[curExerciseRef.current]?.count ?? 0,
      bpm_history:     bpmValues.slice(-60),
      total_frames:    frames.length,
      summary: {
        avg_bpm: bpmValues.length
          ? Math.round(bpmValues.reduce((a, b) => a + b, 0) / bpmValues.length)
          : 0,
        max_bpm: bpmValues.length ? Math.max(...bpmValues) : 0,
        exercises_detected: Object.keys(exFrames).filter(ex => ex !== 'Standing'),
        exercise_frame_counts:    exFrames,
        fatigue_zone_distribution: zoneDist,
        max_reps_per_exercise:     repCounts,
      },
    }

    api.postLive(payload).catch(() => {})
  }, [])

  // ── Detection loop (runs every animation frame) ───────────────────────────
  // Stored in a ref so it's always fresh without being re-created
  const loopFnRef = useRef<() => void>(() => {})

  loopFnRef.current = () => {
    if (stopFlagRef.current) return

    const video  = videoRef.current
    const canvas = canvasRef.current
    const lm     = landmarkerRef.current

    if (!video || !canvas || !lm || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(() => loopFnRef.current())
      return
    }

    const now = Date.now()
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)

    // Run pose detection — pass canvas (not video) so MediaPipe uses our
    // manual Date.now() timestamp instead of video.currentTime, which resets
    // to 0 whenever the stream is re-attached and causes a timestamp mismatch.
    let results: ReturnType<typeof lm.detectForVideo>
    try {
      results = lm.detectForVideo(canvas, now)
    } catch {
      // Graph error (e.g. stale landmarker after stop/start) — skip frame
      rafRef.current = requestAnimationFrame(() => loopFnRef.current())
      return
    }

    let exercise   = 'Standing'
    let confidence = 0
    let jointAngles: JointAngles = {
      left_knee: 0, right_knee: 0, left_hip: 0, right_hip: 0,
      left_elbow: 0, right_elbow: 0, left_shoulder: 0, right_shoulder: 0,
    }

    if (results.landmarks.length > 0) {
      const landmarks = results.landmarks[0]
      jointAngles = computeAngles(landmarks)
      ;[exercise, confidence] = classifyExercise(jointAngles)

      // Update rep counter for the detected exercise
      const angle = primaryAngle(exercise, jointAngles)
      repStatesRef.current[exercise] = updateRep(
        repStatesRef.current[exercise] ?? { count: 0, stage: 'up' },
        exercise,
        angle,
      )

      // Draw pose skeleton on canvas (skip face landmarks 0–10)
      const drawUtils = new DrawingUtils(ctx)
      const bodyConns = PoseLandmarker.POSE_CONNECTIONS.filter(
        c => c.start > 10 && c.end > 10,
      )
      drawUtils.drawConnectors(landmarks, bodyConns, {
        color: 'rgba(255,255,255,0.7)',
        lineWidth: 2,
      })
      drawUtils.drawLandmarks(
        landmarks.filter((_, i) => i > 10),
        { radius: 4, color: '#00ff41', fillColor: '#00ff41' },
      )
    }

    // Update live refs
    curExerciseRef.current = exercise
    curConfRef.current     = confidence

    // Record frame
    const elapsed = (now - startTimeRef.current) / 1000
    const currentRep = repStatesRef.current[exercise]?.count ?? 0

    framesRef.current.push({
      timestamp:        new Date(now).toISOString(),
      session_id:       sessionIdRef.current,
      exercise_type:    exercise,
      confidence:       Math.round(confidence * 100) / 100,
      bpm:              bpmRef.current,
      fatigue_zone:     zoneRef.current,
      rep_count:        currentRep,
      duration_seconds: Math.round(elapsed * 10) / 10,
      joint_angles: {
        left_knee:      roundAngle(jointAngles.left_knee),
        right_knee:     roundAngle(jointAngles.right_knee),
        left_hip:       roundAngle(jointAngles.left_hip),
        right_hip:      roundAngle(jointAngles.right_hip),
        left_elbow:     roundAngle(jointAngles.left_elbow),
        right_elbow:    roundAngle(jointAngles.right_elbow),
        left_shoulder:  roundAngle(jointAngles.left_shoulder),
        right_shoulder: roundAngle(jointAngles.right_shoulder),
      },
    })

    // Update React state every 5 frames to avoid excessive renders
    frameCounterRef.current++
    if (frameCounterRef.current % 5 === 0) {
      setState(prev => ({
        ...prev,
        exercise,
        confidence,
        reps:           currentRep,
        elapsedSeconds: Math.round(elapsed),
        totalFrames:    framesRef.current.length,
        bpm:            bpmRef.current,
        zone:           zoneRef.current,
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
      await new Promise<void>(resolve => {
        video.onloadedmetadata = () => resolve()
      })
      await video.play()

      // Reset session state
      const sessionId = makeSessionId()
      sessionIdRef.current   = sessionId
      startTimeRef.current   = Date.now()
      framesRef.current      = []
      frameCounterRef.current = 0
      repStatesRef.current   = Object.fromEntries(
        EXERCISES.map(ex => [ex, { count: 0, stage: 'up' as const }])
      )
      bpmRef.current       = initialBpm
      zoneRef.current      = 'Normal'
      stopFlagRef.current  = false
      curExerciseRef.current = 'Standing'
      curConfRef.current     = 0

      // Initial zone fetch
      await fetchZone(initialBpm)

      // Start detection loop
      rafRef.current = requestAnimationFrame(() => loopFnRef.current())

      // Post live state + refresh zone every second
      liveTimerRef.current = setInterval(() => {
        fetchZone(bpmRef.current)
        postLiveSnapshot()
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
        error:     err instanceof Error ? err.message : 'Failed to start camera',
      }))
    }
  }, [initLandmarker, videoRef, fetchZone, postLiveSnapshot])

  // ── Stop ──────────────────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    stopFlagRef.current = true

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current)
      liveTimerRef.current = null
    }

    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    // Build and save session
    const frames = framesRef.current
    if (frames.length > 0) {
      const startIso = new Date(startTimeRef.current).toISOString()
      const endIso   = new Date().toISOString()
      const duration = (Date.now() - startTimeRef.current) / 1000

      const bpmValues: number[] = frames.map(f => f.bpm)
      const exFrames:  Record<string, number> = {}
      const zoneDist:  Record<string, number> = {}

      for (const f of frames) {
        exFrames[f.exercise_type] = (exFrames[f.exercise_type] ?? 0) + 1
        zoneDist[f.fatigue_zone]  = (zoneDist[f.fatigue_zone]  ?? 0) + 1
      }

      const maxReps: Record<string, number> = {}
      for (const [ex, st] of Object.entries(repStatesRef.current)) {
        if (st.count > 0) maxReps[ex] = st.count
      }

      const total = frames.length || 1
      const zonePct: Record<string, number> = {}
      for (const [z, c] of Object.entries(zoneDist)) {
        zonePct[z] = Math.round((c / total) * 1000) / 10
      }

      const session = {
        session_id:       sessionIdRef.current,
        start_time:       startIso,
        end_time:         endIso,
        duration_seconds: Math.round(duration),
        frames,
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
          avg_bpm: bpmValues.length
            ? Math.round(bpmValues.reduce((a, b) => a + b, 0) / bpmValues.length)
            : 0,
          max_bpm:      bpmValues.length ? Math.max(...bpmValues) : 0,
          min_bpm:      bpmValues.length ? Math.min(...bpmValues) : 0,
          total_frames: frames.length,
        },
      }

      try {
        await api.saveSession(session)
      } catch (e) {
        console.error('Failed to save session:', e)
      }
    }

    // Clear live state on server
    api.postLive({ status: 'idle' }).catch(() => {})

    setState(prev => ({
      ...prev,
      isRunning: false,
      sessionId: null,
    }))
  }, [])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopFlagRef.current = true
      if (rafRef.current)    cancelAnimationFrame(rafRef.current)
      if (liveTimerRef.current) clearInterval(liveTimerRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return { state, start, stop, setBpm }
}
