// ── Session data types ─────────────────────────────────────────────────────

export interface JointAngles {
  left_knee: number
  right_knee: number
  left_hip: number
  right_hip: number
  left_elbow: number
  right_elbow: number
  left_shoulder: number
  right_shoulder: number
}

export interface FrameRecord {
  timestamp: string
  session_id: string
  exercise_type: string
  confidence: number
  bpm: number
  fatigue_zone: string
  rep_count: number
  duration_seconds: number
  joint_angles: JointAngles
}

export interface SessionSummary {
  session_id: string
  start_time: string
  end_time: string
  total_duration_seconds: number
  exercises_detected: string[]
  exercise_frame_counts: Record<string, number>
  max_reps_per_exercise: Record<string, number>
  fatigue_zone_distribution: Record<string, number>
  fatigue_zone_pct: Record<string, number>
  avg_bpm: number
  max_bpm: number
  min_bpm: number
  total_frames: number
}

export interface Session {
  session_id: string
  start_time: string
  end_time: string
  duration_seconds: number
  frames: FrameRecord[]
  summary: SessionSummary
}

// Lightweight metadata returned by GET /api/sessions
export interface SessionMeta {
  id: string
  start_time: string
  end_time: string
  duration_seconds: number
  total_frames: number
  avg_bpm: number
  exercises: string[]
  max_reps: Record<string, number>
}

// ── Chart data types ───────────────────────────────────────────────────────

export interface ExerciseBar {
  exercise: string
  frames: number
}

export interface ZoneSlice {
  name: string
  value: number
  pct: number
}

export interface BpmPoint {
  time: number      // elapsed seconds
  bpm: number
  zone: string
}

export interface RepRow {
  exercise: string
  reps: number
}

// ── Zone colour map ────────────────────────────────────────────────────────

export const ZONE_COLORS: Record<string, string> = {
  Normal:    '#10b981',
  Aerobic:   '#06b6d4',
  Anaerobic: '#f59e0b',
  Maximum:   '#ef4444',
  Recovery:  '#8b5cf6',
  Unknown:   '#94a3b8',
}
