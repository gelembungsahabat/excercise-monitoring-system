"""
FitTrack AI – Main Application
-------------------------------
OpenCV webcam loop that integrates:
    • ExerciseDetector  (MediaPipe pose + rep counting)
    • HRClassifier      (fatigue-zone prediction from BPM)
    • SessionRecorder   (frame-level logging + JSON export)
    • BLEHRMonitor      (optional – real-time BPM from Polar H10 or any
                         BLE heart rate monitor via standard HR Service)

Keyboard controls
-----------------
    b         : Override BPM manually  (type digits → Enter, Esc to cancel)
                In BLE mode this forces a one-time override until the next
                BLE reading arrives.
    s         : Save session manually (session continues)
    r         : Reset rep counters
    q / Esc   : Quit and auto-save the session

BLE quick-start
---------------
    # 1. Find your device address first (one-time):
    python src/ble_hr_monitor.py

    # 2. Run with BLE enabled (name-based scan):
    python src/main.py --ble

    # 3. Or supply the address directly for instant connection:
    python src/main.py --ble --ble-address "A0:9E:1A:XX:XX:XX"
"""

from __future__ import annotations

import logging
import sys
import time
from collections import deque
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

# ── Add project root to path so sibling imports work ──────────────────────
_SRC_DIR = Path(__file__).resolve().parent
_ROOT_DIR = _SRC_DIR.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from src.exercise_detector import ExerciseDetector
from src.hr_classifier import HRClassifier, ZONE_COLORS
from src.session_recorder import SessionRecorder

try:
    from src.ble_hr_monitor import BLEHRMonitor, BLEState
    _BLE_AVAILABLE = True
except ImportError:
    _BLE_AVAILABLE = False
    BLEHRMonitor = None  # type: ignore[assignment,misc]

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ── UI constants ──────────────────────────────────────────────────────────
FONT           = cv2.FONT_HERSHEY_SIMPLEX
FONT_SCALE     = 0.7
FONT_BOLD      = 2
FONT_THIN      = 1
OVERLAY_ALPHA  = 0.55          # translucency of info panels
DEFAULT_BPM    = 120           # starting BPM before user sets one
FRAME_RATE_CAP = 30            # max FPS (prevents busy-loop on fast machines)

# BGR colours
WHITE   = (255, 255, 255)
BLACK   = (0,   0,   0)
GREY    = (80,  80,  80)
YELLOW  = (0,   220, 220)

# BLE status indicator colours (BGR)
BLE_CONNECTED_COLOR    = (80,  220, 80)   # green
BLE_SCANNING_COLOR     = (0,   200, 230)  # yellow
BLE_DISCONNECTED_COLOR = (100, 100, 100)  # grey


# ── Overlay helpers ───────────────────────────────────────────────────────

def _put_text_with_bg(
    img: np.ndarray,
    text: str,
    origin: tuple[int, int],
    color: tuple[int, int, int] = WHITE,
    font_scale: float = FONT_SCALE,
    thickness: int = FONT_THIN,
    bg_color: Optional[tuple[int, int, int]] = BLACK,
    padding: int = 6,
) -> None:
    """Draw text with an optional filled rectangle background."""
    (tw, th), baseline = cv2.getTextSize(text, FONT, font_scale, thickness)
    x, y = origin
    if bg_color is not None:
        cv2.rectangle(
            img,
            (x - padding, y - th - padding),
            (x + tw + padding, y + baseline + padding),
            bg_color,
            cv2.FILLED,
        )
    cv2.putText(img, text, (x, y), FONT, font_scale, color, thickness, cv2.LINE_AA)


def _ble_indicator_color(ble_state: str) -> tuple[int, int, int]:
    """Return BGR colour for the BLE status pill."""
    if ble_state == BLEState.CONNECTED if _BLE_AVAILABLE else "connected":
        return BLE_CONNECTED_COLOR
    if ble_state in ("scanning", "connecting"):
        return BLE_SCANNING_COLOR
    return BLE_DISCONNECTED_COLOR


def _draw_info_panel(
    frame: np.ndarray,
    exercise: str,
    confidence: float,
    zone: str,
    bpm: int,
    reps: int,
    elapsed: float,
    bpm_input_mode: bool,
    bpm_buffer: str,
    ble_state: str = "disabled",
    ble_battery: Optional[int] = None,
) -> None:
    """
    Render the heads-up display overlay on *frame* (in-place).

    Parameters
    ----------
    ble_state : str
        One of BLEState constants or "disabled".
    ble_battery : int | None
        Device battery percentage, shown when connected.
    """
    h, w = frame.shape[:2]
    zone_color = ZONE_COLORS.get(zone, (180, 180, 180))

    # ── Semi-transparent top banner ────────────────────────────────────────
    banner_h = 105
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, banner_h), (20, 20, 20), cv2.FILLED)
    cv2.addWeighted(overlay, OVERLAY_ALPHA, frame, 1 - OVERLAY_ALPHA, 0, frame)

    # Exercise name + confidence
    ex_text   = f"Exercise: {exercise}"
    conf_text = f"Conf: {confidence:.0%}"
    _put_text_with_bg(frame, ex_text,   (12, 32),  WHITE, 0.85, FONT_BOLD, bg_color=None)
    _put_text_with_bg(frame, conf_text, (12, 60),  GREY,  0.6,  FONT_THIN, bg_color=None)

    # ── BLE status pill (top-right) ────────────────────────────────────────
    if ble_state != "disabled":
        ble_color = _ble_indicator_color(ble_state)

        if ble_state == "connected":
            bat_str   = f" | BAT {ble_battery}%" if ble_battery is not None else ""
            ble_label = f"BLE  CONNECTED{bat_str}"
        elif ble_state in ("scanning", "connecting"):
            ble_label = f"BLE  {ble_state.upper()}..."
        else:
            ble_label = "BLE  OFFLINE"

        (bw, bh), _ = cv2.getTextSize(ble_label, FONT, 0.52, FONT_THIN)
        bx = w - bw - 24
        # draw filled pill background
        cv2.rectangle(frame, (bx - 8, 10), (w - 8, bh + 22), (30, 30, 30), cv2.FILLED)
        cv2.rectangle(frame, (bx - 8, 10), (w - 8, bh + 22), ble_color, 1)
        # coloured dot
        cv2.circle(frame, (bx - 0, 10 + bh // 2 + 6), 5, ble_color, cv2.FILLED)
        _put_text_with_bg(frame, ble_label, (bx + 10, bh + 16), ble_color, 0.52, FONT_THIN, bg_color=None)

    # Timer (below BLE pill on top-right)
    mins, secs = divmod(int(elapsed), 60)
    timer_text = f"{mins:02d}:{secs:02d}"
    ty = 80 if ble_state != "disabled" else 42
    _put_text_with_bg(frame, timer_text, (w - 110, ty), YELLOW, 0.9, FONT_BOLD, bg_color=None)

    # ── Semi-transparent bottom panel ─────────────────────────────────────
    panel_h = 90
    overlay2 = frame.copy()
    cv2.rectangle(overlay2, (0, h - panel_h), (w, h), (20, 20, 20), cv2.FILLED)
    cv2.addWeighted(overlay2, OVERLAY_ALPHA, frame, 1 - OVERLAY_ALPHA, 0, frame)

    # Zone indicator (coloured bar on left edge)
    cv2.rectangle(frame, (0, h - panel_h), (8, h), zone_color, cv2.FILLED)

    # Fatigue zone
    zone_text = f"Zone: {zone}"
    _put_text_with_bg(frame, zone_text, (18, h - 60), zone_color, 0.75, FONT_BOLD, bg_color=None)

    # BPM – label changes based on source
    if bpm_input_mode:
        bpm_display = f"BPM override: {bpm_buffer}_"
        bpm_color   = YELLOW
    elif ble_state == "connected":
        bpm_display = f"BPM: {bpm}  [BLE]"
        bpm_color   = BLE_CONNECTED_COLOR
    else:
        bpm_display = f"BPM: {bpm}  [MAN]"
        bpm_color   = WHITE
    _put_text_with_bg(frame, bpm_display, (18, h - 30), bpm_color, 0.7, FONT_THIN, bg_color=None)

    # Reps (right side)
    rep_text = f"Reps: {reps}"
    _put_text_with_bg(frame, rep_text, (w - 150, h - 40), WHITE, 1.0, FONT_BOLD, bg_color=None)

    # ── Keybinding hint bar ────────────────────────────────────────────────
    hints = "[B] BPM override   [S] Save   [R] Reset   [Q] Quit"
    _put_text_with_bg(
        frame, hints,
        (12, h - panel_h + 18),
        GREY, 0.45, FONT_THIN, bg_color=None,
    )


# ── Main app ──────────────────────────────────────────────────────────────

class FitTrackApp:
    """
    Orchestrates the webcam loop with exercise detection, HR zone
    classification, session recording, and optional BLE heart-rate input.

    Parameters
    ----------
    camera_index : int
        OpenCV camera device index (0 = default webcam).
    window_name : str
        Title of the OpenCV display window.
    ble_device_name : str | None
        If set, enables BLE HR monitoring.  Used for advertisement-name
        scanning when ``ble_address`` is not provided.
        Example: ``"Polar H10"``
    ble_address : str | None
        BLE device MAC (Linux/Windows) or UUID (macOS).  Skips scanning
        and connects directly.
    """

    def __init__(
        self,
        camera_index: int = 0,
        window_name: str = "FitTrack AI",
        ble_device_name: Optional[str] = None,
        ble_address: Optional[str] = None,
    ) -> None:
        self.camera_index = camera_index
        self.window_name  = window_name

        logger.info("Initialising FitTrack AI …")

        # Component initialisation
        self.classifier = HRClassifier()
        if not self.classifier.is_loaded():
            logger.info("No pre-trained model found – training now …")
            self.classifier.train()

        self.detector  = ExerciseDetector()
        self.recorder  = SessionRecorder()

        # ── BLE monitor (optional) ─────────────────────────────────────────
        self.ble: Optional["BLEHRMonitor"] = None
        if ble_device_name or ble_address:
            if not _BLE_AVAILABLE:
                logger.error(
                    "BLE requested but 'bleak' is not installed.\n"
                    "Run:  pip install bleak"
                )
            else:
                self.ble = BLEHRMonitor(
                    device_name=ble_device_name or "Polar H10",
                    device_address=ble_address,
                )
                self.ble.start()
                logger.info(
                    "BLE monitor started – waiting for '%s' …",
                    ble_device_name or ble_address,
                )

        # ── State ──────────────────────────────────────────────────────────
        self._bpm:            int  = DEFAULT_BPM
        self._bpm_input_mode: bool = False
        self._bpm_buffer:     str  = ""
        self._running:        bool = False
        self._bpm_history:    deque[int] = deque(maxlen=60)
        self._last_live_write: float = 0.0

    # ── Public API ─────────────────────────────────────────────────────────

    def run(self) -> None:
        """
        Open the webcam, start recording, and enter the main loop.
        Exits when the user presses 'q' / Esc, or the camera fails.
        """
        cap = cv2.VideoCapture(self.camera_index)
        if not cap.isOpened():
            logger.error("Cannot open camera index %d", self.camera_index)
            return

        # Configure capture
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        cap.set(cv2.CAP_PROP_FPS, FRAME_RATE_CAP)

        cv2.namedWindow(self.window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(self.window_name, 1280, 720)

        session_id = self.recorder.start()
        logger.info("Recording session: %s", session_id)
        self._running = True

        frame_interval = 1.0 / FRAME_RATE_CAP
        last_frame_time = time.perf_counter()

        try:
            while self._running:
                # Rate-limit
                now = time.perf_counter()
                if now - last_frame_time < frame_interval:
                    time.sleep(0.001)
                    continue
                last_frame_time = now

                ret, frame = cap.read()
                if not ret:
                    logger.warning("Frame capture failed – retrying …")
                    continue

                # ── Pull BPM from BLE (if connected and not in manual override)
                ble_state   = "disabled"
                ble_battery = None
                if self.ble is not None:
                    ble_state   = self.ble.status
                    ble_battery = self.ble.battery_level
                    if self.ble.is_connected and not self._bpm_input_mode:
                        live_bpm = self.ble.bpm
                        if live_bpm > 0:
                            self._bpm = live_bpm

                # ── Pose detection ──────────────────────────────────────
                annotated, exercise, confidence, reps = self.detector.process_frame(frame)

                # ── HR zone prediction ──────────────────────────────────
                zone = self.classifier.predict(self._bpm)

                # ── Record frame ────────────────────────────────────────
                self.recorder.record_frame(
                    exercise_type=exercise,
                    confidence=confidence,
                    bpm=self._bpm,
                    fatigue_zone=zone,
                    rep_count=reps,
                    joint_angles=self.detector.get_joint_angles(),
                )

                # ── Write live state (~1 Hz) ─────────────────────────────
                self._bpm_history.append(self._bpm)
                if now - self._last_live_write >= 1.0:
                    self._last_live_write = now
                    self.recorder.write_live_state(
                        exercise=exercise,
                        confidence=confidence,
                        bpm=self._bpm,
                        zone=zone,
                        reps=reps,
                        bpm_history=list(self._bpm_history),
                    )

                # ── Render overlay ──────────────────────────────────────
                _draw_info_panel(
                    annotated,
                    exercise=exercise,
                    confidence=confidence,
                    zone=zone,
                    bpm=self._bpm,
                    reps=reps,
                    elapsed=self.recorder.elapsed_seconds(),
                    bpm_input_mode=self._bpm_input_mode,
                    bpm_buffer=self._bpm_buffer,
                    ble_state=ble_state,
                    ble_battery=ble_battery,
                )

                cv2.imshow(self.window_name, annotated)

                # ── Keyboard handling ───────────────────────────────────
                key = cv2.waitKey(1) & 0xFF
                self._handle_key(key)

        except KeyboardInterrupt:
            logger.info("Interrupted by user.")
        finally:
            self._shutdown(cap)

    # ── Private helpers ────────────────────────────────────────────────────

    def _handle_key(self, key: int) -> None:
        """Process a single key press."""
        if self._bpm_input_mode:
            self._handle_bpm_input_key(key)
            return

        if key == ord("q") or key == 27:      # q or Esc → quit
            self._running = False
        elif key == ord("b"):                  # b → BPM input
            self._bpm_input_mode = True
            self._bpm_buffer = ""
            logger.info("BPM input mode activated.")
        elif key == ord("s"):                  # s → manual save
            summary = self.recorder.stop_and_save()
            logger.info("Session manually saved: %s", summary.get("session_id"))
            # Restart recording immediately
            self.recorder.start()
        elif key == ord("r"):                  # r → reset reps
            self.detector.reset_reps()
            logger.info("Rep counters reset.")

    def _handle_bpm_input_key(self, key: int) -> None:
        """Handle key presses while BPM input mode is active."""
        if key == 13 or key == 10:             # Enter → confirm
            try:
                new_bpm = int(self._bpm_buffer)
                if 30 <= new_bpm <= 250:
                    self._bpm = new_bpm
                    logger.info("BPM set to %d", new_bpm)
                else:
                    logger.warning("BPM out of range [30, 250]: %s", self._bpm_buffer)
            except ValueError:
                logger.warning("Invalid BPM input: %s", self._bpm_buffer)
            self._bpm_input_mode = False
            self._bpm_buffer = ""
        elif key == 27:                        # Esc → cancel
            self._bpm_input_mode = False
            self._bpm_buffer = ""
        elif 48 <= key <= 57:                  # digit 0-9
            if len(self._bpm_buffer) < 3:
                self._bpm_buffer += chr(key)
        elif key == 8 and self._bpm_buffer:    # Backspace
            self._bpm_buffer = self._bpm_buffer[:-1]

    def _shutdown(self, cap: cv2.VideoCapture) -> None:
        """Cleanly release resources and save session on exit."""
        logger.info("Shutting down FitTrack AI …")
        if self.recorder.is_active:
            summary = self.recorder.stop_and_save()
            logger.info(
                "Session auto-saved | duration=%.1fs | frames=%d",
                summary.get("total_duration_seconds", 0),
                summary.get("total_frames", 0),
            )
        SessionRecorder.clear_live_state()
        if self.ble is not None:
            self.ble.stop()
        self.detector.close()
        cap.release()
        cv2.destroyAllWindows()
        logger.info("Goodbye!")


# ── Entry point ───────────────────────────────────────────────────────────

def main() -> None:
    """Parse CLI arguments and launch the app."""
    import argparse

    parser = argparse.ArgumentParser(
        description="FitTrack AI – Real-time exercise tracker",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--camera", type=int, default=0,
        help="Camera device index",
    )
    parser.add_argument(
        "--train", action="store_true",
        help="Force re-training the HR classifier before starting",
    )

    # ── BLE options ──────────────────────────────────────────────────────
    ble_group = parser.add_argument_group("BLE heart rate monitor")
    ble_group.add_argument(
        "--ble", action="store_true",
        help="Enable BLE heart rate monitor (Polar H10 or any standard HR device)",
    )
    ble_group.add_argument(
        "--ble-name", type=str, default="Polar H10",
        metavar="NAME",
        help="Advertised device name substring to search for during BLE scan",
    )
    ble_group.add_argument(
        "--ble-address", type=str, default=None,
        metavar="ADDRESS",
        help=(
            "BLE device MAC address (Linux/Windows) or UUID (macOS). "
            "Skips scanning and connects directly. "
            "Find your device address with:  python src/ble_hr_monitor.py"
        ),
    )
    ble_group.add_argument(
        "--ble-scan", action="store_true",
        help="Scan for nearby BLE heart rate devices and exit (does not start the app)",
    )

    args = parser.parse_args()

    # ── BLE scan-only mode ────────────────────────────────────────────────
    if args.ble_scan:
        if not _BLE_AVAILABLE:
            print("ERROR: bleak is not installed.  Run: pip install bleak")
            return
        print("Scanning for BLE heart rate devices (8 s) …\n")
        found = BLEHRMonitor.scan(timeout=8.0)
        if found:
            print(f"Found {len(found)} device(s):\n")
            for d in found:
                print(f"  Name   : {d['name']}")
                print(f"  Address: {d['address']}\n")
            print("Tip: pass the address with --ble-address for instant connection.")
        else:
            print("No BLE HR devices found.  Make sure Bluetooth is on and the "
                  "Polar H10 is worn and powered on.")
        return

    # ── Build and run the app ─────────────────────────────────────────────
    ble_name    = args.ble_name    if (args.ble or args.ble_address) else None
    ble_address = args.ble_address if (args.ble or args.ble_address) else None

    app = FitTrackApp(
        camera_index=args.camera,
        ble_device_name=ble_name,
        ble_address=ble_address,
    )

    if args.train:
        logger.info("Force re-training the HR classifier …")
        app.classifier.train()

    app.run()


if __name__ == "__main__":
    main()
