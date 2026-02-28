"""
Settings Service — manages working/settings.json as the user config file.

Tracked in git so new settings can be shipped with updates. Defaults are
applied automatically for any missing keys so new settings introduced in
future versions just work. registry.json (agent data) is gitignored to
protect user-created agents from being overwritten on pull.
"""

import json
import os
import tempfile
import time
from typing import Any

# Default values for all settings — new settings added here are automatically
# picked up on next load even if the user's settings.json doesn't have them.
DEFAULTS: dict[str, Any] = {
    "self_edit_enabled": True,
    "concurrency_cap": 5,
    "max_team_size": 3,
    "cost_alert_threshold_usd": 0,
    "proactive_mode_enabled": False,
    "proactive_interval_hours": 24,
    "save_uploads_enabled": True,
    "prompt_caching_enabled": True,
    "prevent_sleep_enabled": False,
}

# In-memory cache (TTL-based, invalidated on save)
_settings_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 5.0  # seconds


def _settings_path(working_dir: str) -> str:
    return os.path.join(working_dir, "settings.json")


def load_settings(working_dir: str) -> dict[str, Any]:
    """
    Load user settings with defaults applied for any missing keys.

    If settings.json doesn't exist yet, creates it with all defaults.
    """
    path = _settings_path(working_dir)
    now = time.monotonic()

    # Check cache
    cached = _settings_cache.get(path)
    if cached is not None:
        cached_time, cached_data = cached
        if now - cached_time < _CACHE_TTL:
            return cached_data

    # Start from defaults
    merged = dict(DEFAULTS)

    # Overlay user file if it exists
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                user_data = json.load(f)
            merged.update(user_data)
        except (json.JSONDecodeError, OSError):
            pass  # Corrupted file — fall back to defaults
    else:
        # First run — create the file with defaults
        _write_settings(path, merged)

    _settings_cache[path] = (now, merged)
    return merged


def save_settings(working_dir: str, data: dict[str, Any]) -> None:
    """Atomically write settings.json."""
    path = _settings_path(working_dir)
    _write_settings(path, data)
    # Invalidate cache
    _settings_cache.pop(path, None)


def update_settings(working_dir: str, updates: dict[str, Any]) -> dict[str, Any]:
    """Merge partial updates into the current settings and save."""
    current = load_settings(working_dir)
    current.update(updates)
    save_settings(working_dir, current)
    return current


def _write_settings(path: str, data: dict[str, Any]) -> None:
    """Write JSON atomically (tmp + rename)."""
    dir_name = os.path.dirname(path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
