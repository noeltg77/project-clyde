"""
Sleep Prevention Service — prevents the host machine from sleeping while
the backend is running. Auto-detects OS and uses the appropriate method:

- macOS: spawns `caffeinate -i` (prevents idle sleep)
- Windows: calls SetThreadExecutionState via ctypes (prevents idle sleep)
- Linux: spawns `systemd-inhibit` if available, otherwise no-op
"""

import logging
import platform
import subprocess
import sys
from typing import Optional

logger = logging.getLogger(__name__)

_SYSTEM = platform.system()


class SleepPrevention:
    """Manages sleep prevention across macOS, Windows, and Linux."""

    def __init__(self):
        self._active = False
        self._process: Optional[subprocess.Popen] = None
        self._previous_es_state: Optional[int] = None

    @property
    def is_active(self) -> bool:
        return self._active

    @property
    def platform_name(self) -> str:
        """Human-readable platform label."""
        return {
            "Darwin": "macOS",
            "Windows": "Windows",
            "Linux": "Linux",
        }.get(_SYSTEM, _SYSTEM)

    @property
    def method_description(self) -> str:
        """Describe the method used for the current platform."""
        if _SYSTEM == "Darwin":
            return "caffeinate -i (prevents idle sleep)"
        elif _SYSTEM == "Windows":
            return "SetThreadExecutionState (prevents idle sleep)"
        elif _SYSTEM == "Linux":
            return "systemd-inhibit (prevents idle sleep)"
        return "not supported on this platform"

    def start(self) -> bool:
        """Enable sleep prevention. Returns True if successfully started."""
        if self._active:
            logger.info("[SleepPrevention] Already active — skipping")
            return True

        try:
            if _SYSTEM == "Darwin":
                return self._start_macos()
            elif _SYSTEM == "Windows":
                return self._start_windows()
            elif _SYSTEM == "Linux":
                return self._start_linux()
            else:
                logger.warning(
                    f"[SleepPrevention] Unsupported platform: {_SYSTEM}"
                )
                return False
        except Exception as e:
            logger.error(f"[SleepPrevention] Failed to start: {e}")
            return False

    def stop(self) -> None:
        """Disable sleep prevention and clean up."""
        if not self._active:
            return

        try:
            if _SYSTEM == "Darwin" or _SYSTEM == "Linux":
                self._stop_subprocess()
            elif _SYSTEM == "Windows":
                self._stop_windows()
        except Exception as e:
            logger.error(f"[SleepPrevention] Failed to stop cleanly: {e}")
        finally:
            self._active = False
            logger.info("[SleepPrevention] Stopped")

    # -------------------------------------------------------------------------
    # macOS — caffeinate
    # -------------------------------------------------------------------------

    def _start_macos(self) -> bool:
        """Spawn `caffeinate -i` to prevent idle sleep on macOS."""
        self._process = subprocess.Popen(
            ["caffeinate", "-i"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._active = True
        logger.info(
            f"[SleepPrevention] Started caffeinate (pid={self._process.pid})"
        )
        return True

    # -------------------------------------------------------------------------
    # Windows — SetThreadExecutionState
    # -------------------------------------------------------------------------

    def _start_windows(self) -> bool:
        """Use ctypes to prevent idle sleep on Windows."""
        import ctypes

        # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        ES_CONTINUOUS = 0x80000000
        ES_SYSTEM_REQUIRED = 0x00000001

        result = ctypes.windll.kernel32.SetThreadExecutionState(
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        )
        if result == 0:
            logger.error("[SleepPrevention] SetThreadExecutionState failed")
            return False

        self._active = True
        logger.info("[SleepPrevention] SetThreadExecutionState enabled")
        return True

    def _stop_windows(self) -> None:
        """Reset execution state back to normal on Windows."""
        import ctypes

        ES_CONTINUOUS = 0x80000000
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
        logger.info("[SleepPrevention] SetThreadExecutionState reset")

    # -------------------------------------------------------------------------
    # Linux — systemd-inhibit
    # -------------------------------------------------------------------------

    def _start_linux(self) -> bool:
        """Use systemd-inhibit to prevent idle sleep on Linux."""
        import shutil

        if not shutil.which("systemd-inhibit"):
            logger.warning(
                "[SleepPrevention] systemd-inhibit not found — "
                "sleep prevention unavailable on this Linux system"
            )
            return False

        # systemd-inhibit blocks idle sleep for the lifetime of the child process
        # We use `sleep infinity` as the held process
        self._process = subprocess.Popen(
            [
                "systemd-inhibit",
                "--what=idle",
                "--who=Clyde Backend",
                "--why=Keeping backend alive for scheduled tasks",
                "sleep", "infinity",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._active = True
        logger.info(
            f"[SleepPrevention] Started systemd-inhibit (pid={self._process.pid})"
        )
        return True

    # -------------------------------------------------------------------------
    # Shared — subprocess cleanup (macOS / Linux)
    # -------------------------------------------------------------------------

    def _stop_subprocess(self) -> None:
        """Terminate the caffeinate or systemd-inhibit subprocess."""
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
            logger.info(
                f"[SleepPrevention] Terminated subprocess (pid={self._process.pid})"
            )
        self._process = None
