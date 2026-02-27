"""
Exercise Detector
-----------------
Uses MediaPipe Pose to detect body keypoints from webcam frames, calculates
joint angles, classifies exercises via rule-based angle thresholds, and
maintains per-exercise rep counters using an up/down state machine.

Supported exercises
-------------------
    Standing, Squat, Push-Up, Jumping Jack, Bicep Curl,
    Shoulder Press, Running
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

try:
    import mediapipe as mp
    _MP_AVAILABLE = True
except ImportError:
    _MP_AVAILABLE = False
    mp = None  # type: ignore[assignment]

# ── Logging ────────────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)

# ── Type alias ────────────────────────────────────────────────────────────
Landmark = tuple[float, float, float]   # (x, y, z) normalised


# ── Angle helpers ─────────────────────────────────────────────────────────

def _angle_3pts(a: Landmark, b: Landmark, c: Landmark) -> float:
    """
    Compute the interior angle (degrees) at vertex *b* formed by the
    segments b→a and b→c.

    Parameters
    ----------
    a, b, c : (x, y, z) tuples, normalised [0, 1]
    """
    ax, ay = a[0] - b[0], a[1] - b[1]
    cx, cy = c[0] - b[0], c[1] - b[1]
    dot = ax * cx + ay * cy
    mag_a = math.hypot(ax, ay)
    mag_c = math.hypot(cx, cy)
    if mag_a == 0 or mag_c == 0:
        return 0.0
    cos_theta = max(-1.0, min(1.0, dot / (mag_a * mag_c)))
    return math.degrees(math.acos(cos_theta))


def _landmark_to_tuple(lm) -> Landmark:
    """Convert a MediaPipe NormalizedLandmark to a plain tuple."""
    return (lm.x, lm.y, lm.z)


# ── Joint-angle dataclass ─────────────────────────────────────────────────

@dataclass
class JointAngles:
    """Calculated joint angles for the current frame."""
    left_knee:     float = 0.0
    right_knee:    float = 0.0
    left_hip:      float = 0.0
    right_hip:     float = 0.0
    left_elbow:    float = 0.0
    right_elbow:   float = 0.0
    left_shoulder: float = 0.0
    right_shoulder: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "left_knee":      round(self.left_knee, 1),
            "right_knee":     round(self.right_knee, 1),
            "left_hip":       round(self.left_hip, 1),
            "right_hip":      round(self.right_hip, 1),
            "left_elbow":     round(self.left_elbow, 1),
            "right_elbow":    round(self.right_elbow, 1),
            "left_shoulder":  round(self.left_shoulder, 1),
            "right_shoulder": round(self.right_shoulder, 1),
        }


# ── Rep-counter state machine ─────────────────────────────────────────────

@dataclass
class RepCounter:
    """
    Counts repetitions using a simple up/down state machine.

    The caller feeds angle values; the counter transitions state and
    increments the rep count when a full cycle is detected.
    """
    exercise: str = "Unknown"
    count: int = 0
    stage: str = "up"           # 'up' | 'down'
    _history: list[float] = field(default_factory=list, repr=False)

    # Thresholds for each supported exercise
    _THRESHOLDS: dict[str, dict[str, float]] = field(
        default_factory=lambda: {
            "Squat":          {"down": 90.0,  "up": 160.0},
            "Push-Up":        {"down": 90.0,  "up": 160.0},
            "Bicep Curl":     {"down": 160.0, "up": 50.0},
            "Shoulder Press": {"down": 80.0,  "up": 160.0},
            "Jumping Jack":   {"down": 30.0,  "up": 150.0},
            "Running":        {"down": 60.0,  "up": 140.0},
            "Standing":       {"down": 999.0, "up": 999.0},
        },
        repr=False,
    )

    def update(self, angle: float) -> None:
        """
        Feed the primary control angle for the current exercise and
        update internal state + rep count.

        Parameters
        ----------
        angle : float
            Joint angle in degrees (e.g. knee angle for Squat).
        """
        thresholds = self._THRESHOLDS.get(self.exercise, {"down": 90.0, "up": 160.0})
        down_thr = thresholds["down"]
        up_thr   = thresholds["up"]

        # Bicep Curl: angle goes *down* when arm is curled → invert logic
        if self.exercise == "Bicep Curl":
            if angle < up_thr and self.stage == "up":
                self.stage = "down"
            if angle > down_thr and self.stage == "down":
                self.stage = "up"
                self.count += 1
        else:
            if angle < down_thr and self.stage == "up":
                self.stage = "down"
            if angle > up_thr and self.stage == "down":
                self.stage = "up"
                self.count += 1

    def reset(self) -> None:
        """Reset counter and stage for a new exercise."""
        self.count = 0
        self.stage = "up"
        self._history.clear()


# ── Exercise rules ────────────────────────────────────────────────────────

def _classify_exercise(angles: JointAngles) -> tuple[str, float]:
    """
    Classify the current exercise from joint angles using rule-based
    angle thresholds.

    Returns
    -------
    (exercise_name, confidence)
        confidence is a pseudo-probability in [0, 1].
    """
    lk = angles.left_knee
    rk = angles.right_knee
    lh = angles.left_hip
    rh = angles.right_hip
    le = angles.left_elbow
    re = angles.right_elbow
    ls = angles.left_shoulder
    rs = angles.right_shoulder

    avg_knee  = (lk + rk) / 2
    avg_hip   = (lh + rh) / 2
    avg_elbow = (le + re) / 2
    avg_shoulder = (ls + rs) / 2

    scores: dict[str, float] = {}

    # ── Squat ─────────────────────────────────────────────────────────────
    # Knees bent < 140°, hip < 140°, arms roughly neutral
    squat_score = 0.0
    if avg_knee < 140:
        squat_score += 0.5 * (1 - avg_knee / 140)
    if avg_hip < 140:
        squat_score += 0.3 * (1 - avg_hip / 140)
    if 60 < avg_shoulder < 130:
        squat_score += 0.2
    scores["Squat"] = min(squat_score, 1.0)

    # ── Push-Up ───────────────────────────────────────────────────────────
    # Elbows bent, shoulders forward, hips roughly straight
    pushup_score = 0.0
    if avg_elbow < 140:
        pushup_score += 0.6 * (1 - avg_elbow / 140)
    if 60 < avg_shoulder < 100:
        pushup_score += 0.2
    if avg_knee > 150:
        pushup_score += 0.2
    scores["Push-Up"] = min(pushup_score, 1.0)

    # ── Bicep Curl ────────────────────────────────────────────────────────
    # Elbow < 100°, shoulder stable
    bicep_score = 0.0
    if avg_elbow < 100:
        bicep_score += 0.7 * (1 - avg_elbow / 100)
    if avg_shoulder > 140:
        bicep_score += 0.3
    scores["Bicep Curl"] = min(bicep_score, 1.0)

    # ── Shoulder Press ───────────────────────────────────────────────────
    # Arms raised > 150°, elbows partially extended
    sp_score = 0.0
    if avg_shoulder > 150:
        sp_score += 0.5 * (avg_shoulder - 150) / 30
    if 80 < avg_elbow < 160:
        sp_score += 0.5
    scores["Shoulder Press"] = min(sp_score, 1.0)

    # ── Jumping Jack ─────────────────────────────────────────────────────
    # Arms wide (shoulder > 130°), legs wide (hip > 30°) OR arms down and legs together
    jj_score = 0.0
    if avg_shoulder > 130 and avg_hip > 30:
        jj_score = 0.8
    elif avg_shoulder < 40 and avg_hip < 20:
        jj_score = 0.6
    scores["Jumping Jack"] = min(jj_score, 1.0)

    # ── Running ───────────────────────────────────────────────────────────
    # Asymmetric knee angles with moderate bend, arms swinging
    asym_knee = abs(lk - rk)
    run_score = 0.0
    if asym_knee > 20:
        run_score += 0.5 * min(asym_knee / 60, 1.0)
    if 70 < avg_knee < 160:
        run_score += 0.3
    if abs(le - re) > 20:
        run_score += 0.2
    scores["Running"] = min(run_score, 1.0)

    # ── Standing (default) ───────────────────────────────────────────────
    standing_score = 0.0
    if avg_knee > 160 and avg_hip > 160:
        standing_score = 0.7
    scores["Standing"] = min(standing_score, 1.0)

    # Pick best
    best = max(scores, key=scores.get)  # type: ignore[arg-type]
    confidence = scores[best]

    # Minimum confidence gate
    if confidence < 0.15:
        return "Standing", 0.5

    return best, confidence


# ── Main detector class ───────────────────────────────────────────────────

class ExerciseDetector:
    """
    Wraps MediaPipe Pose to detect exercises and count reps from webcam frames.

    Parameters
    ----------
    min_detection_confidence : float
        MediaPipe minimum detection confidence threshold.
    min_tracking_confidence : float
        MediaPipe minimum tracking confidence threshold.
    """

    def __init__(
        self,
        min_detection_confidence: float = 0.6,
        min_tracking_confidence: float = 0.5,
    ) -> None:
        if not _MP_AVAILABLE:
            raise ImportError(
                "mediapipe is not installed. Run: pip install mediapipe"
            )

        self._mp_pose = mp.solutions.pose
        self._mp_draw = mp.solutions.drawing_utils

        self.pose = self._mp_pose.Pose(
            model_complexity=1,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )

        # ── Body-only drawing specs (exclude face landmarks 0-10) ──────────
        # Indices 0-10: nose, eyes, ears, mouth — skip all of them.
        # Body landmarks start at 11 (LEFT_SHOULDER).
        _FACE_IDX = set(range(11))
        _DrawSpec  = mp.solutions.drawing_utils.DrawingSpec

        # Connections: keep only segments where both endpoints are body joints
        self._body_connections = frozenset(
            (s, e) for s, e in self._mp_pose.POSE_CONNECTIONS
            if s not in _FACE_IDX and e not in _FACE_IDX
        )

        # Landmark dots: invisible for face, green dot for body
        _visible   = _DrawSpec(color=(0, 255, 0),   thickness=2, circle_radius=4)
        _invisible = _DrawSpec(color=(0, 0, 0),     thickness=0, circle_radius=0)
        self._landmark_spec: dict[int, mp.solutions.drawing_utils.DrawingSpec] = {
            i: (_invisible if i in _FACE_IDX else _visible)
            for i in range(33)
        }

        # Connection lines: white body skeleton
        self._connection_spec = _DrawSpec(color=(200, 200, 200), thickness=2)

        # Per-exercise rep counters (shared across instances)
        self._counters: dict[str, RepCounter] = {
            ex: RepCounter(exercise=ex)
            for ex in [
                "Squat", "Push-Up", "Jumping Jack",
                "Bicep Curl", "Shoulder Press", "Running", "Standing",
            ]
        }

        self.current_exercise: str = "Standing"
        self.confidence: float = 0.0
        self.joint_angles: JointAngles = JointAngles()
        self._landmarks: Optional[list] = None

    # ── Public API ─────────────────────────────────────────────────────────

    def process_frame(
        self, frame: np.ndarray
    ) -> tuple[np.ndarray, str, float, int]:
        """
        Run pose estimation on a single BGR frame.

        Parameters
        ----------
        frame : np.ndarray
            BGR image from OpenCV capture.

        Returns
        -------
        annotated_frame : np.ndarray
            Frame with pose landmarks drawn.
        exercise : str
            Detected exercise name.
        confidence : float
            Detection confidence in [0, 1].
        reps : int
            Current rep count for the detected exercise.
        """
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = self.pose.process(rgb)
        rgb.flags.writeable = True
        annotated = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

        if results.pose_landmarks:
            self._landmarks = results.pose_landmarks.landmark
            self._mp_draw.draw_landmarks(
                annotated,
                results.pose_landmarks,
                self._body_connections,
                landmark_drawing_spec=self._landmark_spec,
                connection_drawing_spec=self._connection_spec,
            )

            self.joint_angles = self._compute_angles()
            exercise, confidence = _classify_exercise(self.joint_angles)

            # Update rep counter only for the active exercise
            self.current_exercise = exercise
            self.confidence = confidence
            control_angle = self._primary_angle(exercise)
            self._counters[exercise].update(control_angle)

        else:
            self._landmarks = None
            self.current_exercise = "Standing"
            self.confidence = 0.0

        reps = self._counters[self.current_exercise].count
        return annotated, self.current_exercise, self.confidence, reps

    def get_rep_count(self, exercise: Optional[str] = None) -> int:
        """
        Return rep count for *exercise* (or current exercise if None).
        """
        ex = exercise or self.current_exercise
        return self._counters.get(ex, RepCounter()).count

    def get_all_reps(self) -> dict[str, int]:
        """Return a dict of {exercise: rep_count} for all exercises."""
        return {ex: c.count for ex, c in self._counters.items()}

    def reset_reps(self, exercise: Optional[str] = None) -> None:
        """Reset rep counter for *exercise* (or all if None)."""
        if exercise:
            if exercise in self._counters:
                self._counters[exercise].reset()
        else:
            for c in self._counters.values():
                c.reset()

    def get_joint_angles(self) -> dict[str, float]:
        """Return current joint angles as a plain dict."""
        return self.joint_angles.to_dict()

    def close(self) -> None:
        """Release MediaPipe resources."""
        self.pose.close()

    # ── Private helpers ────────────────────────────────────────────────────

    def _compute_angles(self) -> JointAngles:
        """Extract landmark positions and calculate all joint angles."""
        lm = self._landmarks
        if lm is None:
            return JointAngles()

        def _t(idx: int) -> Landmark:
            return _landmark_to_tuple(lm[idx])

        PL = self._mp_pose.PoseLandmark

        # Hips, knees, ankles
        l_hip    = _t(PL.LEFT_HIP.value)
        r_hip    = _t(PL.RIGHT_HIP.value)
        l_knee   = _t(PL.LEFT_KNEE.value)
        r_knee   = _t(PL.RIGHT_KNEE.value)
        l_ankle  = _t(PL.LEFT_ANKLE.value)
        r_ankle  = _t(PL.RIGHT_ANKLE.value)

        # Shoulders, elbows, wrists
        l_shoulder = _t(PL.LEFT_SHOULDER.value)
        r_shoulder = _t(PL.RIGHT_SHOULDER.value)
        l_elbow    = _t(PL.LEFT_ELBOW.value)
        r_elbow    = _t(PL.RIGHT_ELBOW.value)
        l_wrist    = _t(PL.LEFT_WRIST.value)
        r_wrist    = _t(PL.RIGHT_WRIST.value)

        return JointAngles(
            left_knee=      _angle_3pts(l_hip,    l_knee,   l_ankle),
            right_knee=     _angle_3pts(r_hip,    r_knee,   r_ankle),
            left_hip=       _angle_3pts(l_shoulder, l_hip,  l_knee),
            right_hip=      _angle_3pts(r_shoulder, r_hip,  r_knee),
            left_elbow=     _angle_3pts(l_shoulder, l_elbow, l_wrist),
            right_elbow=    _angle_3pts(r_shoulder, r_elbow, r_wrist),
            left_shoulder=  _angle_3pts(l_elbow,  l_shoulder, l_hip),
            right_shoulder= _angle_3pts(r_elbow,  r_shoulder, r_hip),
        )

    def _primary_angle(self, exercise: str) -> float:
        """Return the primary control angle used by the rep counter."""
        a = self.joint_angles
        mapping = {
            "Squat":          (a.left_knee + a.right_knee) / 2,
            "Push-Up":        (a.left_elbow + a.right_elbow) / 2,
            "Bicep Curl":     (a.left_elbow + a.right_elbow) / 2,
            "Shoulder Press": (a.left_shoulder + a.right_shoulder) / 2,
            "Jumping Jack":   (a.left_shoulder + a.right_shoulder) / 2,
            "Running":        (a.left_knee + a.right_knee) / 2,
            "Standing":       (a.left_knee + a.right_knee) / 2,
        }
        return mapping.get(exercise, 0.0)

    def __enter__(self) -> "ExerciseDetector":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
