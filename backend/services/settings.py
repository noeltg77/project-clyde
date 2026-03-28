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
    "clyde_model": "opus",
    "subagent_default_model": "sonnet",
    "self_edit_enabled": True,
    "concurrency_cap": 5,
    "max_team_size": 3,
    "cost_alert_threshold_usd": 0,
    "proactive_mode_enabled": False,
    "proactive_interval_hours": 24,
    "save_uploads_enabled": True,
    "prompt_caching_enabled": True,
    "prevent_sleep_enabled": False,
    "debug_mode_enabled": False,
    "telegram_enabled": False,
    "telegram_mode": "polling",  # "polling" | "webhook"
    "telegram_webhook_url": "",
    "telegram_polling_interval": 1.0,  # seconds between polls
    "telegram_allowed_user_ids": [],  # empty = allow all
    "agent_provider": "anthropic",  # "anthropic" | "openrouter"
    "openrouter_model": "anthropic/claude-sonnet-4",
    "openrouter_subagent_model": "anthropic/claude-haiku-4.5",
}

# Maps model tier names to Claude API model IDs
MODEL_ID_MAP: dict[str, str] = {
    "opus": "claude-opus-4-6",
    "sonnet": "claude-sonnet-4-6",
    "haiku": "claude-haiku-4-5-20251001",
}

# Maps Gemini tier names to Google API model IDs
GEMINI_MODEL_ID_MAP: dict[str, str] = {
    "gemini-pro": "gemini-3.1-pro-preview",
    "gemini-flash": "gemini-3-flash-preview",
    "gemini-lite": "gemini-3.1-flash-lite-preview",
}

# Gemini pricing per 1M tokens: (input_usd, output_usd)
# Pro has tiered pricing: $2/$12 under 200k tokens, $4/$18 above 200k tokens.
# We use the standard (<200k) rate; the client applies the higher rate when needed.
GEMINI_PRICING: dict[str, tuple[float, float]] = {
    "gemini-3.1-pro-preview": (2.0, 12.0),
    "gemini-3-flash-preview": (0.50, 3.0),
    "gemini-3.1-flash-lite-preview": (0.25, 1.50),
}

# Pro pricing for prompts exceeding 200k tokens
GEMINI_PRO_LONG_CONTEXT_PRICING: tuple[float, float] = (4.0, 18.0)

# Maps OpenAI tier names to API model IDs
OPENAI_MODEL_ID_MAP: dict[str, str] = {
    "gpt-5.4": "gpt-5.4",
    "gpt-5.4-mini": "gpt-5.4-mini",
    "gpt-5.4-nano": "gpt-5.4-nano",
}

# OpenAI pricing per 1M tokens: (input_usd, output_usd)
OPENAI_PRICING: dict[str, tuple[float, float]] = {
    "gpt-5.4": (2.50, 15.0),
    "gpt-5.4-mini": (0.75, 4.50),
    "gpt-5.4-nano": (0.20, 1.25),
}

# Maps Clyde model tier names to OpenRouter model IDs (for claude_task delegation)
OPENROUTER_MODEL_ID_MAP: dict[str, str] = {
    "opus": "anthropic/claude-opus-4",
    "sonnet": "anthropic/claude-sonnet-4",
    "haiku": "anthropic/claude-haiku-4.5",
}

# OpenRouter pricing per 1M tokens: (input_usd, output_usd)
# Used as fallback when ChatOpenRouter doesn't expose cost in response_metadata.
OPENROUTER_PRICING: dict[str, tuple[float, float]] = {
    # Anthropic
    "anthropic/claude-opus-4": (15.0, 75.0),
    "anthropic/claude-sonnet-4": (3.0, 15.0),
    "anthropic/claude-haiku-4.5": (1.0, 5.0),
    # OpenAI
    "openai/gpt-5.4": (2.50, 15.0),
    "openai/gpt-5.4-mini": (0.75, 4.50),
    # Google
    "google/gemini-2.5-pro": (1.25, 10.0),
    "google/gemini-2.5-flash": (0.15, 0.60),
    # Meta
    "meta-llama/llama-4-maverick": (0.50, 0.70),
    # DeepSeek
    "deepseek/deepseek-r1": (0.55, 2.19),
}

# Popular OpenRouter models for the frontend dropdown
OPENROUTER_POPULAR_MODELS: list[str] = [
    "anthropic/claude-opus-4",
    "anthropic/claude-sonnet-4",
    "openai/gpt-5.4",
    "openai/gpt-5.4-mini",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "meta-llama/llama-4-maverick",
    "deepseek/deepseek-r1",
]

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
