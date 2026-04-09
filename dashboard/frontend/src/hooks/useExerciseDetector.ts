/**
 * TypeScript port of tracker/exercise_detector.py
 *
 * Pure functions — no React, no MediaPipe import.
 * Accepts MediaPipe landmark arrays and returns joint angles,
 * exercise classification, and rep-counter updates.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface JointAngles {
  left_knee:      number
  right_knee:     number
  left_hip:       number
  right_hip:      number
  left_elbow:     number
  right_elbow:    number
  left_shoulder:  number
  right_shoulder: number
}

export interface RepState {
  count: number
  stage: 'up' | 'down'
}

// MediaPipe Pose landmark indices (same as Python)
const LM = {
  LEFT_SHOULDER:  11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW:     13,
  RIGHT_ELBOW:    14,
  LEFT_WRIST:     15,
  RIGHT_WRIST:    16,
  LEFT_HIP:       23,
  RIGHT_HIP:      24,
  LEFT_KNEE:      25,
  RIGHT_KNEE:     26,
  LEFT_ANKLE:     27,
  RIGHT_ANKLE:    28,
} as const

// ── Angle calculation ────────────────────────────────────────────────────────

interface Pt { x: number; y: number }

function angle3pts(a: Pt, b: Pt, c: Pt): number {
  const ax = a.x - b.x, ay = a.y - b.y
  const cx = c.x - b.x, cy = c.y - b.y
  const dot  = ax * cx + ay * cy
  const magA = Math.hypot(ax, ay)
  const magC = Math.hypot(cx, cy)
  if (magA === 0 || magC === 0) return 0
  return (Math.acos(Math.max(-1, Math.min(1, dot / (magA * magC)))) * 180) / Math.PI
}

export function computeAngles(lm: Array<{ x: number; y: number; z: number }>): JointAngles {
  const lh = lm[LM.LEFT_HIP],       rh = lm[LM.RIGHT_HIP]
  const lk = lm[LM.LEFT_KNEE],      rk = lm[LM.RIGHT_KNEE]
  const la = lm[LM.LEFT_ANKLE],     ra = lm[LM.RIGHT_ANKLE]
  const ls = lm[LM.LEFT_SHOULDER],  rs = lm[LM.RIGHT_SHOULDER]
  const le = lm[LM.LEFT_ELBOW],     re = lm[LM.RIGHT_ELBOW]
  const lw = lm[LM.LEFT_WRIST],     rw = lm[LM.RIGHT_WRIST]

  return {
    left_knee:      angle3pts(lh, lk, la),
    right_knee:     angle3pts(rh, rk, ra),
    left_hip:       angle3pts(ls, lh, lk),
    right_hip:      angle3pts(rs, rh, rk),
    left_elbow:     angle3pts(ls, le, lw),
    right_elbow:    angle3pts(rs, re, rw),
    left_shoulder:  angle3pts(le, ls, lh),
    right_shoulder: angle3pts(re, rs, rh),
  }
}

// ── Exercise classification ──────────────────────────────────────────────────

export function classifyExercise(a: JointAngles): [string, number] {
  const avgKnee     = (a.left_knee     + a.right_knee)     / 2
  const avgHip      = (a.left_hip      + a.right_hip)      / 2
  const avgElbow    = (a.left_elbow    + a.right_elbow)    / 2
  const avgShoulder = (a.left_shoulder + a.right_shoulder) / 2

  const scores: Record<string, number> = {}

  // Squat: knees & hip bent
  let s = 0
  if (avgKnee < 140)                           s += 0.5 * (1 - avgKnee / 140)
  if (avgHip  < 140)                           s += 0.3 * (1 - avgHip  / 140)
  if (avgShoulder > 60 && avgShoulder < 130)   s += 0.2
  scores['Squat'] = Math.min(s, 1)

  // Push-Up: elbows bent, shoulders forward, knees straight
  s = 0
  if (avgElbow < 140)                          s += 0.6 * (1 - avgElbow / 140)
  if (avgShoulder > 60 && avgShoulder < 100)   s += 0.2
  if (avgKnee > 150)                           s += 0.2
  scores['Push-Up'] = Math.min(s, 1)

  // Bicep Curl: elbow < 100, shoulder stable
  s = 0
  if (avgElbow < 100)    s += 0.7 * (1 - avgElbow / 100)
  if (avgShoulder > 140) s += 0.3
  scores['Bicep Curl'] = Math.min(s, 1)

  // Shoulder Press: arms raised > 150
  s = 0
  if (avgShoulder > 150)               s += 0.5 * (avgShoulder - 150) / 30
  if (avgElbow > 80 && avgElbow < 160) s += 0.5
  scores['Shoulder Press'] = Math.min(s, 1)

  // Jumping Jack: arms wide + legs wide, or arms down + legs together
  s = 0
  if      (avgShoulder > 130 && avgHip > 30)  s = 0.8
  else if (avgShoulder < 40  && avgHip < 20)  s = 0.6
  scores['Jumping Jack'] = Math.min(s, 1)

  // Running: asymmetric knees
  const asymKnee = Math.abs(a.left_knee - a.right_knee)
  s = 0
  if (asymKnee > 20)                                   s += 0.5 * Math.min(asymKnee / 60, 1)
  if (avgKnee > 70 && avgKnee < 160)                   s += 0.3
  if (Math.abs(a.left_elbow - a.right_elbow) > 20)     s += 0.2
  scores['Running'] = Math.min(s, 1)

  // Standing: default
  s = avgKnee > 160 && avgHip > 160 ? 0.7 : 0
  scores['Standing'] = Math.min(s, 1)

  const [best, conf] = Object.entries(scores).reduce(
    (max, cur) => cur[1] > max[1] ? cur : max,
    ['Standing', 0] as [string, number],
  )
  return conf < 0.15 ? ['Standing', 0.5] : [best, conf]
}

// ── Rep counter ──────────────────────────────────────────────────────────────

const REP_THRESHOLDS: Record<string, { down: number; up: number }> = {
  'Squat':          { down: 90,  up: 160 },
  'Push-Up':        { down: 90,  up: 160 },
  'Bicep Curl':     { down: 160, up: 50  },
  'Shoulder Press': { down: 80,  up: 160 },
  'Jumping Jack':   { down: 30,  up: 150 },
  'Running':        { down: 60,  up: 140 },
  'Standing':       { down: 999, up: 999 },
}

export function updateRep(state: RepState, exercise: string, angle: number): RepState {
  const thr = REP_THRESHOLDS[exercise] ?? { down: 90, up: 160 }
  let { count, stage } = state

  if (exercise === 'Bicep Curl') {
    if (angle < thr.up   && stage === 'up')   stage = 'down'
    if (angle > thr.down && stage === 'down') { stage = 'up'; count++ }
  } else {
    if (angle < thr.down && stage === 'up')   stage = 'down'
    if (angle > thr.up   && stage === 'down') { stage = 'up'; count++ }
  }
  return { count, stage }
}

export function primaryAngle(exercise: string, a: JointAngles): number {
  const avgKnee     = (a.left_knee     + a.right_knee)     / 2
  const avgElbow    = (a.left_elbow    + a.right_elbow)    / 2
  const avgShoulder = (a.left_shoulder + a.right_shoulder) / 2
  const map: Record<string, number> = {
    'Squat':          avgKnee,
    'Push-Up':        avgElbow,
    'Bicep Curl':     avgElbow,
    'Shoulder Press': avgShoulder,
    'Jumping Jack':   avgShoulder,
    'Running':        avgKnee,
    'Standing':       avgKnee,
  }
  return map[exercise] ?? 0
}

export const EXERCISES = [
  'Squat', 'Push-Up', 'Jumping Jack',
  'Bicep Curl', 'Shoulder Press', 'Running', 'Standing',
] as const
