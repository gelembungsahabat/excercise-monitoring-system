"""
BLE Heart Rate Monitor
-----------------------
Connects to a Bluetooth Low Energy heart rate monitor (e.g. Polar H10)
using the ``bleak`` library and streams BPM + RR-interval data in real time.

The BLE asyncio event loop runs in a **background daemon thread** so it does
not block the synchronous OpenCV main loop.  All shared mutable state is
protected by a ``threading.Lock``.

Polar H10 BLE profile
---------------------
  Service        : Heart Rate  (UUID 0x180D)
  Characteristic : Heart Rate Measurement  (UUID 0x2A37)

  Byte 0 – Flags
      bit 0  : 0 = UINT8 BPM,  1 = UINT16 BPM
      bit 1-2: Sensor Contact bits
      bit 3  : Energy Expended present
      bit 4  : RR-Interval data present
  Bytes 1-N – BPM value (uint8 or uint16, little-endian)
  Bytes N+  – RR intervals (uint16 each, unit = 1/1024 s → multiply by ~0.977 ms)

  Battery Level  (UUID 0x2A19) – percentage 0-100
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections import deque
from typing import Callable, Optional

try:
    from bleak import BleakClient, BleakScanner
    _BLEAK_AVAILABLE = True
except ImportError:
    _BLEAK_AVAILABLE = False

# ── Logging ────────────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)

# ── BLE UUID constants ─────────────────────────────────────────────────────
HR_SERVICE_UUID        = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT_UUID    = "00002a37-0000-1000-8000-00805f9b34fb"
BATTERY_LEVEL_UUID     = "00002a19-0000-1000-8000-00805f9b34fb"

# ── Connection states ──────────────────────────────────────────────────────
class BLEState:
    IDLE         = "idle"
    SCANNING     = "scanning"
    CONNECTING   = "connecting"
    CONNECTED    = "connected"
    DISCONNECTED = "disconnected"


# ── BLE data parser ────────────────────────────────────────────────────────

def _parse_hr_measurement(data: bytearray) -> dict:
    """
    Parse a BLE Heart Rate Measurement characteristic payload.

    Parameters
    ----------
    data : bytearray
        Raw bytes from the BLE notification.

    Returns
    -------
    dict with keys:
        ``bpm``             – int, heart rate in beats per minute
        ``rr_intervals_ms`` – list[int], RR intervals in milliseconds
        ``contact``         – bool | None, sensor contact status
    """
    if not data:
        return {"bpm": 0, "rr_intervals_ms": [], "contact": None}

    flags = data[0]
    is_uint16      = bool(flags & 0x01)   # bit 0
    contact_feat   = bool(flags & 0x04)   # bit 2
    contact_status = bool(flags & 0x02)   # bit 1
    has_energy     = bool(flags & 0x08)   # bit 3
    has_rr         = bool(flags & 0x10)   # bit 4

    idx = 1

    # BPM value
    if is_uint16:
        bpm = int.from_bytes(data[idx:idx + 2], byteorder="little")
        idx += 2
    else:
        bpm = data[idx]
        idx += 1

    # Skip Energy Expended (2 bytes)
    if has_energy:
        idx += 2

    # RR intervals (each 2 bytes, unit = 1/1024 second)
    rr_ms: list[int] = []
    if has_rr:
        while idx + 1 < len(data):
            raw_rr = int.from_bytes(data[idx:idx + 2], byteorder="little")
            rr_ms.append(round(raw_rr / 1024.0 * 1000))   # → milliseconds
            idx += 2

    return {
        "bpm":             bpm,
        "rr_intervals_ms": rr_ms,
        "contact":         (contact_status if contact_feat else None),
    }


# ── Main monitor class ────────────────────────────────────────────────────

class BLEHRMonitor:
    """
    Connects to a BLE heart rate monitor and exposes real-time BPM data.

    Designed to run the BLE event loop in a background daemon thread so that
    the synchronous OpenCV main loop can poll ``monitor.bpm`` without blocking.

    Parameters
    ----------
    device_name : str
        Substring to match against the BLE device's advertised name
        (case-insensitive).  Used when ``device_address`` is not supplied.
        Default: ``"Polar H10"``.
    device_address : str | None
        MAC address (Linux/Windows) or UUID (macOS) of the device.
        If provided, scanning is skipped and the monitor connects directly.
    on_bpm_update : Callable[[int], None] | None
        Optional callback invoked from the BLE thread on every new BPM.
    retry_interval : float
        Seconds to wait between connection attempts.  Default: 3.0.
    rr_history_size : int
        Number of recent RR-interval values to keep in the rolling buffer.

    Usage
    -----
    >>> monitor = BLEHRMonitor(device_name="Polar H10")
    >>> monitor.start()
    >>> # … inside webcam loop …
    >>> bpm = monitor.bpm
    >>> print(monitor.status)   # "connected" / "scanning" / etc.
    >>> monitor.stop()
    """

    def __init__(
        self,
        device_name: str = "Polar H10",
        device_address: Optional[str] = None,
        on_bpm_update: Optional[Callable[[int], None]] = None,
        retry_interval: float = 3.0,
        rr_history_size: int = 30,
    ) -> None:
        if not _BLEAK_AVAILABLE:
            raise ImportError(
                "bleak is not installed.\n"
                "Run:  pip install bleak"
            )

        self.device_name     = device_name
        self.device_address  = device_address
        self.on_bpm_update   = on_bpm_update
        self.retry_interval  = retry_interval

        # ── Thread-safe state ──────────────────────────────────────────────
        self._lock    = threading.Lock()
        self._bpm:     int  = 0
        self._battery: Optional[int] = None
        self._state:   str  = BLEState.IDLE
        self._contact: Optional[bool] = None
        self._rr_buf:  deque[int] = deque(maxlen=rr_history_size)
        self._found_address: Optional[str] = None

        # ── Thread / loop handles ──────────────────────────────────────────
        self._thread:    Optional[threading.Thread] = None
        self._loop:      Optional[asyncio.AbstractEventLoop] = None
        self._stop_flag: threading.Event = threading.Event()

    # ── Public properties ─────────────────────────────────────────────────

    @property
    def bpm(self) -> int:
        """Latest BPM reading. Returns 0 if not yet connected."""
        with self._lock:
            return self._bpm

    @property
    def status(self) -> str:
        """Current connection state string (see ``BLEState``)."""
        with self._lock:
            return self._state

    @property
    def is_connected(self) -> bool:
        with self._lock:
            return self._state == BLEState.CONNECTED

    @property
    def battery_level(self) -> Optional[int]:
        """Battery percentage (0-100) or None if unavailable."""
        with self._lock:
            return self._battery

    @property
    def sensor_contact(self) -> Optional[bool]:
        """
        Whether the sensor is in good contact with skin.
        None means the device does not report contact status.
        """
        with self._lock:
            return self._contact

    @property
    def rr_intervals(self) -> list[int]:
        """Recent RR intervals in milliseconds (newest-last)."""
        with self._lock:
            return list(self._rr_buf)

    @property
    def device_found_address(self) -> Optional[str]:
        """Address of the discovered device, once scanning succeeds."""
        with self._lock:
            return self._found_address

    # ── Lifecycle ─────────────────────────────────────────────────────────

    def start(self) -> None:
        """
        Start the BLE event loop in a background daemon thread.
        Safe to call multiple times (no-op if already running).
        """
        if self._thread and self._thread.is_alive():
            logger.warning("BLE monitor already running.")
            return
        self._stop_flag.clear()
        self._thread = threading.Thread(
            target=self._thread_main,
            name="BLE-HR-Monitor",
            daemon=True,
        )
        self._thread.start()
        logger.info("BLE HR monitor thread started (target: '%s').", self.device_name)

    def stop(self) -> None:
        """Disconnect and stop the background thread gracefully."""
        self._stop_flag.set()
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread:
            self._thread.join(timeout=6)
        with self._lock:
            self._state = BLEState.IDLE
            self._bpm   = 0
        logger.info("BLE HR monitor stopped.")

    # ── Static helpers ────────────────────────────────────────────────────

    @staticmethod
    def scan(timeout: float = 8.0) -> list[dict]:
        """
        Blocking scan for nearby BLE heart-rate devices.

        Filters by the standard Heart Rate Service UUID so only HR-capable
        devices are returned.

        Parameters
        ----------
        timeout : float
            Scan duration in seconds.

        Returns
        -------
        list[dict]
            Each entry: ``{"name": str, "address": str}``
        """
        if not _BLEAK_AVAILABLE:
            return []

        async def _do_scan() -> list[dict]:
            devices = await BleakScanner.discover(
                timeout=timeout,
                service_uuids=[HR_SERVICE_UUID],
            )
            return [
                {"name": d.name or "Unknown", "address": d.address}
                for d in devices
            ]

        try:
            return asyncio.run(_do_scan())
        except Exception as exc:
            logger.error("BLE scan failed: %s", exc)
            return []

    # ── Thread entry point ────────────────────────────────────────────────

    def _thread_main(self) -> None:
        """Thread target: owns and runs the asyncio event loop."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._connect_loop())
        except Exception as exc:
            logger.error("BLE event loop crashed: %s", exc)
        finally:
            self._loop.close()

    # ── Async connection loop ─────────────────────────────────────────────

    async def _connect_loop(self) -> None:
        """
        Continuously attempt to connect to the target device.
        Retries automatically after disconnection or failed scan.
        """
        while not self._stop_flag.is_set():
            try:
                address = self.device_address or await self._scan_for_device()

                if address is None:
                    with self._lock:
                        self._state = BLEState.SCANNING
                    logger.warning(
                        "Device '%s' not found – retrying in %.0f s",
                        self.device_name, self.retry_interval,
                    )
                    await asyncio.sleep(self.retry_interval)
                    continue

                with self._lock:
                    self._state = BLEState.CONNECTING
                logger.info("Connecting to %s …", address)

                async with BleakClient(
                    address,
                    disconnected_callback=self._on_disconnect,
                ) as client:
                    with self._lock:
                        self._state         = BLEState.CONNECTED
                        self._found_address = address
                    logger.info(
                        "Connected to %s  (MTU %s)",
                        address, client.mtu_size,
                    )

                    await self._read_battery(client)
                    await client.start_notify(HR_MEASUREMENT_UUID, self._on_hr_notify)
                    logger.info("Heart rate notifications active.")

                    # Keep alive until disconnect or stop requested
                    while client.is_connected and not self._stop_flag.is_set():
                        await asyncio.sleep(0.3)

                    await client.stop_notify(HR_MEASUREMENT_UUID)

            except Exception as exc:
                logger.warning("BLE error: %s – retrying in %.0f s", exc, self.retry_interval)

            with self._lock:
                self._state = BLEState.DISCONNECTED
                self._bpm   = 0

            if not self._stop_flag.is_set():
                await asyncio.sleep(self.retry_interval)

    async def _scan_for_device(self) -> Optional[str]:
        """Scan for a device whose advertised name contains ``self.device_name``."""
        with self._lock:
            self._state = BLEState.SCANNING

        logger.info("Scanning for '%s' …", self.device_name)
        try:
            devices = await BleakScanner.discover(timeout=6.0)
        except Exception as exc:
            logger.error("BLE scan error: %s", exc)
            return None

        target = self.device_name.upper()
        for device in devices:
            name = (device.name or "").upper()
            if target in name:
                logger.info("Found: %s  [%s]", device.name, device.address)
                return device.address

        return None

    async def _read_battery(self, client: "BleakClient") -> None:
        """Attempt to read the battery level characteristic (non-fatal on failure)."""
        try:
            data = await client.read_gatt_char(BATTERY_LEVEL_UUID)
            with self._lock:
                self._battery = data[0]
            logger.info("Battery: %d%%", self._battery)
        except Exception:
            pass   # Not all HR monitors expose this characteristic

    # ── BLE notification callback ─────────────────────────────────────────

    def _on_hr_notify(self, _sender: int, data: bytearray) -> None:
        """
        Called by bleak from the asyncio thread on every HR notification.
        Parses the payload and updates shared state under the lock.
        """
        try:
            parsed  = _parse_hr_measurement(data)
            new_bpm = parsed["bpm"]

            with self._lock:
                self._bpm     = new_bpm
                self._contact = parsed.get("contact")
                for rr in parsed.get("rr_intervals_ms", []):
                    self._rr_buf.append(rr)

            logger.debug(
                "BPM=%d  RR=%s  contact=%s",
                new_bpm, parsed["rr_intervals_ms"], parsed.get("contact"),
            )

            if self.on_bpm_update:
                self.on_bpm_update(new_bpm)

        except Exception as exc:
            logger.warning("HR notify parse error: %s", exc)

    def _on_disconnect(self, _client: "BleakClient") -> None:
        """Called by bleak when the BLE device disconnects unexpectedly."""
        with self._lock:
            self._state = BLEState.DISCONNECTED
            self._bpm   = 0
        logger.warning("BLE device disconnected – will reconnect …")

    # ── Context manager support ───────────────────────────────────────────

    def __enter__(self) -> "BLEHRMonitor":
        self.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.stop()

    def __repr__(self) -> str:
        return (
            f"BLEHRMonitor(device='{self.device_name}', "
            f"status='{self.status}', bpm={self.bpm})"
        )


# ── CLI scan utility ──────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Scanning for BLE heart rate devices (8 s) …\n")
    found = BLEHRMonitor.scan(timeout=8.0)
    if found:
        print(f"Found {len(found)} device(s):\n")
        for d in found:
            print(f"  Name   : {d['name']}")
            print(f"  Address: {d['address']}\n")
        print("Pass the address with:  python src/main.py --ble --ble-address <ADDRESS>")
    else:
        print("No BLE heart rate devices found.")
        print("Make sure Bluetooth is on and the Polar H10 strap is worn.")
