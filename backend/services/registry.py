"""
Registry Service — manages working/registry.json as the single source of truth for all agents.

Clyde (the orchestrator) is the only agent that modifies the registry,
via custom MCP tools exposed through the Claude Agent SDK.
"""

import json
import os
import random
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# In-memory registry cache (TTL-based, invalidated on save)
_registry_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 5.0  # seconds


def _registry_path(working_dir: str) -> str:
    return os.path.join(working_dir, "registry.json")


def load_registry(working_dir: str) -> dict[str, Any]:
    """Read and parse registry.json with in-memory TTL cache."""
    path = _registry_path(working_dir)
    now = time.monotonic()

    cached = _registry_cache.get(path)
    if cached is not None:
        cached_time, cached_data = cached
        if now - cached_time < _CACHE_TTL:
            return cached_data

    with open(path, "r") as f:
        data = json.load(f)
    _registry_cache[path] = (now, data)
    return data


def save_registry(working_dir: str, data: dict[str, Any]) -> None:
    """Atomically write back to registry.json (write to tmp, then rename)."""
    path = _registry_path(working_dir)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    dir_name = os.path.dirname(path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        # Clean up temp file on failure
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    # Invalidate cache so next load_registry() picks up the fresh data
    _registry_cache.pop(path, None)


def get_active_agents(working_dir: str) -> list[dict[str, Any]]:
    """Return all agents with status 'active'."""
    registry = load_registry(working_dir)
    return [a for a in registry.get("agents", []) if a.get("status") == "active"]


def get_agent_by_name(working_dir: str, name: str) -> dict[str, Any] | None:
    """Find an agent by name (case-insensitive). Also checks the orchestrator."""
    registry = load_registry(working_dir)
    name_lower = name.lower()

    # Check orchestrator first (Clyde)
    orchestrator = registry.get("orchestrator", {})
    if orchestrator.get("name", "").lower() == name_lower:
        return orchestrator

    for agent in registry.get("agents", []):
        if agent["name"].lower() == name_lower:
            return agent
    return None


def get_agent_by_id(working_dir: str, registry_id: str) -> dict[str, Any] | None:
    """Find an agent by registry ID. Also checks the orchestrator."""
    registry = load_registry(working_dir)

    # Check orchestrator first (Clyde)
    orchestrator = registry.get("orchestrator", {})
    if orchestrator.get("id") == registry_id:
        return orchestrator

    for agent in registry.get("agents", []):
        if agent["id"] == registry_id:
            return agent
    return None


def create_agent(
    working_dir: str,
    name: str,
    role: str,
    model: str = "sonnet",
    avatar: str | None = None,
    system_prompt: str = "",
    tools: list[str] | None = None,
    skills: list[str] | None = None,
    gender: str = "male",
) -> dict[str, Any]:
    """
    Create a new agent:
    1. Generate UUID
    2. Select avatar if not provided
    3. Write system prompt file
    4. Initialise memory file
    5. Create working directory
    6. Add to registry
    """
    registry = load_registry(working_dir)

    # Check name uniqueness
    name_lower = name.lower()
    for existing in registry.get("agents", []):
        if existing["name"].lower() == name_lower:
            raise ValueError(f"Agent with name '{name}' already exists")

    # Generate ID
    agent_id = f"agt-{uuid.uuid4().hex[:12]}"

    # Select avatar if not provided
    if not avatar:
        avatar = select_random_avatar(working_dir, gender)

    # System prompt path
    prompt_filename = f"{name.lower()}-system.md"
    system_prompt_path = f"/working/prompts/{prompt_filename}"

    # Write system prompt file
    prompt_full_path = os.path.join(working_dir, "prompts", prompt_filename)
    with open(prompt_full_path, "w") as f:
        f.write(system_prompt)

    # Initialise memory file
    memory_filename = f"{name.lower()}-memory.md"
    memory_full_path = os.path.join(working_dir, "memory", memory_filename)
    with open(memory_full_path, "w") as f:
        f.write(f"# {name} — Memory\n\n_Memory file initialised {datetime.now(timezone.utc).strftime('%Y-%m-%d')}_\n")

    # Create agent working directory
    agent_work_dir = os.path.join(working_dir, "agents", name.lower())
    os.makedirs(agent_work_dir, exist_ok=True)

    # Build agent entry
    agent_entry = {
        "id": agent_id,
        "name": name,
        "role": role,
        "model": model,
        "avatar": avatar,
        "system_prompt_path": system_prompt_path,
        "memory_path": f"/working/memory/{memory_filename}",
        "working_dir": f"/working/agents/{name.lower()}",
        "status": "active",
        "tools": tools or ["Read", "Edit", "Write", "Glob", "Grep"],
        "skills": skills or [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # Add to registry
    if "agents" not in registry:
        registry["agents"] = []
    registry["agents"].append(agent_entry)
    save_registry(working_dir, registry)

    return agent_entry


def update_agent(
    working_dir: str, registry_id: str, updates: dict[str, Any]
) -> dict[str, Any]:
    """Partial update of an agent's configuration. Also supports the orchestrator."""
    registry = load_registry(working_dir)

    # Prevent updating protected fields
    protected = {"id", "created_at"}
    updates = {k: v for k, v in updates.items() if k not in protected}

    # Check orchestrator first
    orchestrator = registry.get("orchestrator", {})
    if orchestrator.get("id") == registry_id:
        registry["orchestrator"] = {**orchestrator, **updates}
        save_registry(working_dir, registry)
        return registry["orchestrator"]

    for i, agent in enumerate(registry.get("agents", [])):
        if agent["id"] == registry_id:
            registry["agents"][i] = {**agent, **updates}
            save_registry(working_dir, registry)
            return registry["agents"][i]

    raise ValueError(f"Agent with id '{registry_id}' not found")


def archive_agent(working_dir: str, registry_id: str) -> dict[str, Any]:
    """Set an agent's status to 'archived'."""
    return update_agent(working_dir, registry_id, {"status": "archived"})


def get_used_avatars(working_dir: str) -> set[str]:
    """Collect all avatar paths currently in use by active/paused agents."""
    registry = load_registry(working_dir)
    used = set()

    # Orchestrator avatar
    orch = registry.get("orchestrator", {})
    if orch.get("avatar"):
        used.add(orch["avatar"])

    # Agent avatars
    for agent in registry.get("agents", []):
        if agent.get("status") != "archived" and agent.get("avatar"):
            used.add(agent["avatar"])

    return used


def select_random_avatar(working_dir: str, gender: str = "male") -> str | None:
    """
    Scan frontend/public/avatars/{gender}/ for .jpeg files,
    find ones not already assigned, and return a random unused avatar path.
    Returns None if no avatars are available.
    """
    # Navigate from working dir to frontend/public/avatars
    project_root = os.path.dirname(working_dir)
    avatars_dir = os.path.join(project_root, "frontend", "public", "avatars", gender)

    if not os.path.isdir(avatars_dir):
        return None

    # Find all jpeg files
    available = []
    for filename in os.listdir(avatars_dir):
        if filename.lower().endswith((".jpeg", ".jpg", ".png")):
            avatar_path = f"/avatars/{gender}/{filename}"
            available.append(avatar_path)

    if not available:
        return None

    # Filter out already-used avatars
    used = get_used_avatars(working_dir)
    unused = [a for a in available if a not in used]

    if not unused:
        # All avatars used — return a random one anyway (allow reuse)
        return random.choice(available)

    return random.choice(unused)
