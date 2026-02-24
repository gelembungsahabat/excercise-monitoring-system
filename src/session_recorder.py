"""
Session Recorder
----------------
Records per-frame exercise data during a live session and persists it as
a timestamped JSON file.  Also generates a session summary dictionary that
is consumed by both the main app and the Streamlit dashboard.

JSON schema (data/sessions/session_YYYYMMDD_HHMMSS.json)
---------------------------------------------------------
{
    "session_id":  "session_20240101_120000",
    "start_time":  "2024-01-01T12:00:00",
    "end_time":    "2024-01-01T12:05:00",
    "duration_seconds": 300.0,
    "frames": [
        {
            "timestamp":       "2024-01-01T12:00:01.123456",
            "session_id":      "session_20240101_120000",
            "exercise_type":   "Squat",
            "confidence":      0.82,
            "bpm":             135,
            "fatigue_zone":    "Anaerobic",
            "rep_count":       3,
            "duration_seconds": 1.0,
            "joint_angles":    {...}
        },
        ...
    ],
    "summary": { ... }
}
"""

from __future__ import annotations

import json
import logging
import os
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
SESSIONS_DIR = BASE_DIR / "data" / "sessions"

# ── Logging ────────────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)


# ── FrameRecord dataclass ─────────────────────────────────────────────────

def _make_frame(
    session_id: str,
    exercise_type: str,
    confidence: float,
    bpm: int,
    fatigue_zone: str,
    rep_count: int,
    elapsed_seconds: float,
    joint_angles: dict[str, float],
) -> dict[str, Any]:
    """Construct a single frame record dict."""
    return {
        "timestamp":        datetime.now().isoformat(),
        "session_id":       session_id,
        "exercise_type":    exercise_type,
        "confidence":       round(confidence, 4),
        "bpm":              bpm,
        "fatigue_zone":     fatigue_zone,
        "rep_count":        rep_count,
        "duration_seconds": round(elapsed_seconds, 2),
        "joint_angles":     joint_angles,
    }


# ── Session Recorder ──────────────────────────────────────────────────────

class SessionRecorder:
    """
    Records exercise session data frame-by-frame and saves it to JSON.

    Usage
    -----
    >>> recorder = SessionRecorder()
    >>> recorder.start()
    >>> # inside the webcam loop:
    >>> recorder.record_frame(exercise_type="Squat", ...)
    >>> # when done:
    >>> summary = recorder.stop_and_save()

    Parameters
    ----------
    sessions_dir : Path | str
        Directory where JSON session files are written.
    max_frames : int
        Maximum number of frames stored in memory (prevents OOM on long
        sessions; older frames are silently discarded).
    """

    def __init__(
        self,
        sessions_dir: Path | str = SESSIONS_DIR,
        max_frames: int = 10_000,
    ) -> None:
        self.sessions_dir = Path(sessions_dir)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.max_frames = max_frames

        self._frames: list[dict[str, Any]] = []
        self._session_id: str = ""
        self._start_dt: Optional[datetime] = None
        self._end_dt: Optional[datetime] = None
        self._active: bool = False

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def start(self, session_id: Optional[str] = None) -> str:
        """
        Begin a new recording session.

        Parameters
        ----------
        session_id : str, optional
            Custom session identifier; auto-generated if not provided.

        Returns
        -------
        str
            The session identifier.
        """
        if self._active:
            logger.warning("Session already active – stopping previous session first.")
            self.stop_and_save()

        self._start_dt = datetime.now()
        self._session_id = session_id or f"session_{self._start_dt.strftime('%Y%m%d_%H%M%S')}"
        self._frames = []
        self._end_dt = None
        self._active = True
        logger.info("Session started: %s", self._session_id)
        return self._session_id

    def record_frame(
        self,
        exercise_type: str,
        confidence: float,
        bpm: int,
        fatigue_zone: str,
        rep_count: int,
        joint_angles: Optional[dict[str, float]] = None,
    ) -> None:
        """
        Append one frame's data to the in-memory buffer.

        Parameters
        ----------
        exercise_type : str
            Name of the detected exercise.
        confidence : float
            Exercise detection confidence [0, 1].
        bpm : int
            Current heart-rate reading (manual or simulated).
        fatigue_zone : str
            Predicted fatigue zone from HRClassifier.
        rep_count : int
            Cumulative rep count for the current exercise.
        joint_angles : dict[str, float], optional
            Joint angle dictionary from ExerciseDetector.
        """
        if not self._active:
            logger.warning("record_frame() called but session is not active.")
            return

        elapsed = (datetime.now() - self._start_dt).total_seconds()  # type: ignore[operator]
        frame = _make_frame(
            session_id=self._session_id,
            exercise_type=exercise_type,
            confidence=confidence,
            bpm=bpm,
            fatigue_zone=fatigue_zone,
            rep_count=rep_count,
            elapsed_seconds=elapsed,
            joint_angles=joint_angles or {},
        )

        if len(self._frames) >= self.max_frames:
            self._frames.pop(0)  # drop oldest frame
        self._frames.append(frame)

    def stop_and_save(self) -> dict[str, Any]:
        """
        Finalise the session, persist it to disk, and return the summary.

        Returns
        -------
        dict[str, Any]
            Session summary (see ``_build_summary``).
        """
        if not self._active:
            logger.warning("stop_and_save() called but no active session.")
            return {}

        self._end_dt = datetime.now()
        self._active = False

        summary = self._build_summary()
        self._write_json(summary)
        logger.info(
            "Session saved: %s  (%d frames, %.1fs)",
            self._session_id, len(self._frames),
            summary.get("total_duration_seconds", 0),
        )
        return summary

    # ── Properties ────────────────────────────────────────────────────────

    @property
    def is_active(self) -> bool:
        """True while a session is being recorded."""
        return self._active

    @property
    def session_id(self) -> str:
        """Current (or most recent) session identifier."""
        return self._session_id

    @property
    def frame_count(self) -> int:
        """Number of frames recorded so far."""
        return len(self._frames)

    def elapsed_seconds(self) -> float:
        """Seconds since session start (0 if not started)."""
        if self._start_dt is None:
            return 0.0
        end = self._end_dt or datetime.now()
        return (end - self._start_dt).total_seconds()

    # ── Summary helpers ────────────────────────────────────────────────────

    def _build_summary(self) -> dict[str, Any]:
        """
        Compute aggregate statistics over all recorded frames.

        Returns
        -------
        dict with keys:
            - session_id
            - start_time, end_time
            - total_duration_seconds
            - exercises_detected          : list of unique exercise names
            - max_reps_per_exercise       : {exercise: max_rep_count}
            - fatigue_zone_distribution   : {zone: frame_count}
            - fatigue_zone_pct            : {zone: percentage}
            - avg_bpm, max_bpm, min_bpm
            - total_frames
        """
        total_duration = self.elapsed_seconds()

        exercises_seen: Counter[str] = Counter()
        max_reps: dict[str, int] = defaultdict(int)
        zone_dist: Counter[str] = Counter()
        bpm_values: list[int] = []

        for f in self._frames:
            ex   = f.get("exercise_type", "Unknown")
            reps = f.get("rep_count", 0)
            zone = f.get("fatigue_zone", "Unknown")
            bpm  = f.get("bpm", 0)

            exercises_seen[ex] += 1
            max_reps[ex] = max(max_reps[ex], reps)
            zone_dist[zone] += 1
            if bpm > 0:
                bpm_values.append(bpm)

        n = len(self._frames) or 1
        zone_pct = {z: round(c / n * 100, 1) for z, c in zone_dist.items()}

        summary = {
            "session_id":               self._session_id,
            "start_time":               self._start_dt.isoformat() if self._start_dt else "",
            "end_time":                 self._end_dt.isoformat() if self._end_dt else "",
            "total_duration_seconds":   round(total_duration, 2),
            "exercises_detected":       list(exercises_seen.keys()),
            "exercise_frame_counts":    dict(exercises_seen),
            "max_reps_per_exercise":    dict(max_reps),
            "fatigue_zone_distribution": dict(zone_dist),
            "fatigue_zone_pct":         zone_pct,
            "avg_bpm":  round(sum(bpm_values) / len(bpm_values), 1) if bpm_values else 0,
            "max_bpm":  max(bpm_values) if bpm_values else 0,
            "min_bpm":  min(bpm_values) if bpm_values else 0,
            "total_frames":             len(self._frames),
        }
        return summary

    def _write_json(self, summary: dict[str, Any]) -> None:
        """Serialise session data + summary to a JSON file."""
        payload: dict[str, Any] = {
            "session_id":        self._session_id,
            "start_time":        self._start_dt.isoformat() if self._start_dt else "",
            "end_time":          self._end_dt.isoformat() if self._end_dt else "",
            "duration_seconds":  round(self.elapsed_seconds(), 2),
            "frames":            self._frames,
            "summary":           summary,
        }

        filename = f"{self._session_id}.json"
        out_path = self.sessions_dir / filename
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
        logger.info("Session JSON written → %s", out_path)

    # ── Static helpers ─────────────────────────────────────────────────────

    @staticmethod
    def load_session(path: Path | str) -> dict[str, Any]:
        """
        Load a previously saved session JSON from *path*.

        Parameters
        ----------
        path : Path | str
            Absolute or relative path to the JSON file.

        Returns
        -------
        dict[str, Any]
            Full session payload including 'frames' and 'summary'.
        """
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)

    @staticmethod
    def list_sessions(sessions_dir: Path | str = SESSIONS_DIR) -> list[Path]:
        """
        Return all session JSON files in *sessions_dir*, sorted newest-first.

        Parameters
        ----------
        sessions_dir : Path | str
            Directory to search.

        Returns
        -------
        list[Path]
        """
        d = Path(sessions_dir)
        if not d.exists():
            return []
        files = sorted(d.glob("session_*.json"), key=os.path.getmtime, reverse=True)
        return list(files)

    def get_live_summary(self) -> dict[str, Any]:
        """
        Return a partial summary for display while the session is still active.
        """
        summary = self._build_summary()
        summary["status"] = "active"
        return summary
