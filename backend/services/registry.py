"""
Registry Service — manages the distributed team file structure as the single
source of truth for all agents.

Data is stored across multiple files:
  - working/teams/teams.json        — index of all teams + orchestrator config
  - working/teams/{team-id}.json    — per-team file with members, workflows, delegation notes
  - working/workflows/{id}.json     — individual workflow definitions

Clyde (the orchestrator) is the only agent that modifies these files,
via custom MCP tools exposed through the Claude Agent SDK.

For backward compatibility, load_registry() aggregates all team files into the
legacy {orchestrator, agents, teams} shape so that all existing callsites
(main.py, clyde.py, tools.py, scheduler.py, etc.) continue to work unchanged.
"""

import json
import logging
import os
import random
import shutil
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ─── In-memory file cache (TTL-based, invalidated on write) ──────

_file_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 5.0  # seconds


def _read_json_cached(path: str) -> dict[str, Any]:
    """Read and cache a JSON file with TTL."""
    now = time.monotonic()
    cached = _file_cache.get(path)
    if cached is not None:
        cached_time, cached_data = cached
        if now - cached_time < _CACHE_TTL:
            return cached_data

    with open(path, "r") as f:
        data = json.load(f)
    _file_cache[path] = (now, data)
    return data


def _invalidate_cache(path: str) -> None:
    """Remove a specific file from cache."""
    _file_cache.pop(path, None)


def _invalidate_all_caches() -> None:
    """Clear all cached data."""
    _file_cache.clear()


def _write_json_atomic(path: str, data: dict[str, Any]) -> None:
    """Atomically write JSON (write to tmp, then rename). Invalidates cache."""
    dir_name = os.path.dirname(path)
    os.makedirs(dir_name, exist_ok=True)
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
    _invalidate_cache(path)


# ─── Path helpers ────────────────────────────────────────────────

def _teams_index_path(working_dir: str) -> str:
    """Path to the teams index file."""
    return os.path.join(working_dir, "teams", "teams.json")


def _default_teams_index_path(working_dir: str) -> str:
    """Path to the default teams index template."""
    return os.path.join(working_dir, "teams", "teams.default.json")


def _default_team_unassigned_path(working_dir: str) -> str:
    """Path to the default unassigned team template."""
    return os.path.join(working_dir, "teams", "team-unassigned.default.json")


def _team_file_path(working_dir: str, team_id: str) -> str:
    """Path to an individual team file."""
    return os.path.join(working_dir, "teams", f"{team_id}.json")


def _legacy_registry_path(working_dir: str) -> str:
    """Old registry.json path — used for migration detection."""
    return os.path.join(working_dir, "registry.json")


# ─── Bootstrap & Migration ───────────────────────────────────────

def _bootstrap_teams(working_dir: str) -> None:
    """Bootstrap teams/ directory from default templates on first run."""
    teams_dir = os.path.join(working_dir, "teams")
    os.makedirs(teams_dir, exist_ok=True)

    index_path = _teams_index_path(working_dir)
    default_index = _default_teams_index_path(working_dir)

    if os.path.exists(default_index):
        shutil.copy2(default_index, index_path)
    else:
        # Create minimal index inline
        _write_json_atomic(index_path, {
            "version": "1.0",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "orchestrator": {
                "id": "clyde-001",
                "name": "Clyde",
                "role": "CEO & Team Orchestrator",
                "model": "opus",
                "avatar": "/avatars/clyde.jpeg",
                "system_prompt_path": "/working/prompts/clyde-system.md",
                "memory_path": "/working/memory/clyde-memory.md",
                "self_edit_enabled": True,
                "status": "active",
                "skills": ["Skill creator"],
                "tools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
            },
            "teams": [
                {
                    "id": "team-unassigned",
                    "name": "Unassigned",
                    "color": "#6B7280",
                    "file": "teams/team-unassigned.json",
                }
            ],
        })

    # Create unassigned team file
    unassigned_path = _team_file_path(working_dir, "team-unassigned")
    if not os.path.exists(unassigned_path):
        default_unassigned = _default_team_unassigned_path(working_dir)
        if os.path.exists(default_unassigned):
            shutil.copy2(default_unassigned, unassigned_path)
        else:
            _write_json_atomic(unassigned_path, {
                "id": "team-unassigned",
                "name": "Unassigned",
                "color": "#6B7280",
                "workflows": [],
                "delegation_notes": "",
                "members": [],
            })


def _migrate_from_legacy_registry(working_dir: str) -> None:
    """One-time migration from monolithic registry.json to teams/ structure."""
    legacy_path = _legacy_registry_path(working_dir)
    if not os.path.exists(legacy_path):
        return

    logger.info("[REGISTRY] Migrating from legacy registry.json to teams/ structure")

    with open(legacy_path, "r") as f:
        old_registry = json.load(f)

    teams_dir = os.path.join(working_dir, "teams")
    os.makedirs(teams_dir, exist_ok=True)

    orchestrator = old_registry.get("orchestrator", {})
    old_teams = old_registry.get("teams", [])
    old_agents = old_registry.get("agents", [])

    # Build team index entries — always include unassigned
    team_index_entries = [
        {
            "id": "team-unassigned",
            "name": "Unassigned",
            "color": "#6B7280",
            "file": "teams/team-unassigned.json",
        }
    ]

    # Map agents to teams
    agents_by_team: dict[str, list[dict[str, Any]]] = {"team-unassigned": []}
    for team in old_teams:
        tid = team["id"]
        agents_by_team[tid] = []
        team_index_entries.append({
            "id": tid,
            "name": team["name"],
            "color": team.get("color", "#6B7280"),
            "file": f"teams/{tid}.json",
        })

    for agent in old_agents:
        team_id = agent.get("team") or "team-unassigned"
        if team_id not in agents_by_team:
            agents_by_team[team_id] = []
        # Build member entry — remove the team field (it's implicit from the file)
        member = {**agent}
        member.pop("team", None)
        if "handles" not in member:
            member["handles"] = []
        agents_by_team[team_id].append(member)

    # Write teams.json index
    teams_index = {
        "version": "1.0",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "orchestrator": orchestrator,
        "teams": team_index_entries,
    }
    _write_json_atomic(_teams_index_path(working_dir), teams_index)

    # Write individual team files
    for team_entry in team_index_entries:
        tid = team_entry["id"]
        team_data: dict[str, Any] = {
            "id": tid,
            "name": team_entry["name"],
            "color": team_entry["color"],
            "workflows": [],
            "delegation_notes": "",
            "members": agents_by_team.get(tid, []),
        }
        # Preserve created_at from old team data if available
        for ot in old_teams:
            if ot["id"] == tid:
                team_data["created_at"] = ot.get("created_at", "")
                break
        _write_json_atomic(_team_file_path(working_dir, tid), team_data)

    # Backup old file (don't delete — user might need it)
    backup_path = legacy_path + ".migrated"
    os.rename(legacy_path, backup_path)
    logger.info(f"[REGISTRY] Migration complete. Old registry backed up to {backup_path}")


# ─── Core load/save (backward-compatible aggregation) ────────────

def load_registry(working_dir: str) -> dict[str, Any]:
    """Aggregate teams/teams.json + individual team files into the legacy
    registry shape: {orchestrator, agents, teams, version, updated_at}.

    Performs migration from registry.json on first call if needed.
    Performs bootstrap from default templates if no files exist.
    """
    index_path = _teams_index_path(working_dir)

    # Migration: if legacy registry.json exists but teams.json doesn't, migrate
    if not os.path.exists(index_path):
        legacy_path = _legacy_registry_path(working_dir)
        if os.path.exists(legacy_path):
            _migrate_from_legacy_registry(working_dir)
        else:
            _bootstrap_teams(working_dir)

    # Read the index
    index = _read_json_cached(index_path)

    # Aggregate agents from all team files
    all_agents: list[dict[str, Any]] = []
    teams_meta: list[dict[str, Any]] = []

    for team_entry in index.get("teams", []):
        team_id = team_entry["id"]
        team_path = _team_file_path(working_dir, team_id)
        if os.path.exists(team_path):
            team_data = _read_json_cached(team_path)
            for member in team_data.get("members", []):
                # Re-inject the team field for backward compat
                agent_copy = {**member}
                if team_id != "team-unassigned":
                    agent_copy["team"] = team_id
                else:
                    agent_copy["team"] = None
                all_agents.append(agent_copy)
            teams_meta.append({
                "id": team_id,
                "name": team_entry.get("name", team_data.get("name", "")),
                "color": team_entry.get("color", team_data.get("color", "#6B7280")),
                "created_at": team_data.get("created_at", ""),
            })

    return {
        "orchestrator": index.get("orchestrator", {}),
        "agents": all_agents,
        # Exclude team-unassigned from teams list (frontend expects unassigned = team: null)
        "teams": [t for t in teams_meta if t["id"] != "team-unassigned"],
        "version": index.get("version", "1.0"),
        "updated_at": index.get("updated_at", ""),
    }


def save_registry(working_dir: str, data: dict[str, Any]) -> None:
    """Write aggregated data back to the distributed file structure.

    Used primarily for import/restore operations. For normal CRUD,
    prefer the targeted functions (create_agent, update_agent, etc.)
    which modify only the relevant file.
    """
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    agents = data.get("agents", [])
    teams = data.get("teams", [])

    # Build team index entries — always include unassigned
    team_index_entries: list[dict[str, Any]] = [
        {
            "id": "team-unassigned",
            "name": "Unassigned",
            "color": "#6B7280",
            "file": "teams/team-unassigned.json",
        }
    ]
    for t in teams:
        team_index_entries.append({
            "id": t["id"],
            "name": t["name"],
            "color": t.get("color", "#6B7280"),
            "file": f"teams/{t['id']}.json",
        })

    # Write teams.json index
    index_data = {
        "version": data.get("version", "1.0"),
        "updated_at": data["updated_at"],
        "orchestrator": data.get("orchestrator", {}),
        "teams": team_index_entries,
    }
    _write_json_atomic(_teams_index_path(working_dir), index_data)

    # Group agents by team
    agents_by_team: dict[str, list[dict[str, Any]]] = {}
    for entry in team_index_entries:
        agents_by_team[entry["id"]] = []
    for agent in agents:
        tid = agent.get("team") or "team-unassigned"
        if tid not in agents_by_team:
            agents_by_team[tid] = []
        member = {**agent}
        member.pop("team", None)
        agents_by_team[tid].append(member)

    # Write team files
    for entry in team_index_entries:
        tid = entry["id"]
        team_data: dict[str, Any] = {
            "id": tid,
            "name": entry["name"],
            "color": entry["color"],
            "workflows": [],
            "delegation_notes": "",
            "members": agents_by_team.get(tid, []),
        }
        # Preserve extra fields from existing team files
        existing_team_path = _team_file_path(working_dir, tid)
        if os.path.exists(existing_team_path):
            try:
                with open(existing_team_path, "r") as f:
                    existing = json.load(f)
                team_data["workflows"] = existing.get("workflows", [])
                team_data["delegation_notes"] = existing.get("delegation_notes", "")
                if "created_at" in existing:
                    team_data["created_at"] = existing["created_at"]
            except Exception:
                pass
        _write_json_atomic(existing_team_path, team_data)

    _invalidate_all_caches()


def _touch_index_timestamp(working_dir: str) -> None:
    """Update the updated_at timestamp in teams.json without rewriting everything."""
    index_path = _teams_index_path(working_dir)
    index = _read_json_cached(index_path)
    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_json_atomic(index_path, index)


# ─── Public team-file accessors ──────────────────────────────────

def load_teams_index(working_dir: str) -> dict[str, Any]:
    """Read teams/teams.json directly (not the aggregated view)."""
    index_path = _teams_index_path(working_dir)
    if not os.path.exists(index_path):
        # Trigger bootstrap/migration
        load_registry(working_dir)
    return _read_json_cached(index_path)


def load_team_file(working_dir: str, team_id: str) -> dict[str, Any]:
    """Read a specific team file."""
    path = _team_file_path(working_dir, team_id)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Team file not found: {path}")
    return _read_json_cached(path)


# ─── Agent queries ───────────────────────────────────────────────

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


# ─── Agent CRUD ──────────────────────────────────────────────────

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
    6. Add to team-unassigned.json
    """
    # Check name uniqueness across all team files
    registry = load_registry(working_dir)
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
        "handles": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # Add to team-unassigned.json
    unassigned_path = _team_file_path(working_dir, "team-unassigned")
    if not os.path.exists(unassigned_path):
        _bootstrap_teams(working_dir)
    team_data = _read_json_cached(unassigned_path)
    # Force a fresh read to avoid stale cache
    _invalidate_cache(unassigned_path)
    with open(unassigned_path, "r") as f:
        team_data = json.load(f)
    team_data["members"].append(agent_entry)
    _write_json_atomic(unassigned_path, team_data)

    # Update index timestamp
    _touch_index_timestamp(working_dir)

    return agent_entry


def update_agent(
    working_dir: str, registry_id: str, updates: dict[str, Any]
) -> dict[str, Any]:
    """Partial update of an agent's configuration. Also supports the orchestrator."""
    # Prevent updating protected fields
    protected = {"id", "created_at"}
    updates = {k: v for k, v in updates.items() if k not in protected}

    # Check orchestrator first
    index_path = _teams_index_path(working_dir)
    if not os.path.exists(index_path):
        load_registry(working_dir)  # trigger bootstrap

    # Force fresh read
    _invalidate_cache(index_path)
    with open(index_path, "r") as f:
        index = json.load(f)

    orchestrator = index.get("orchestrator", {})
    if orchestrator.get("id") == registry_id:
        index["orchestrator"] = {**orchestrator, **updates}
        index["updated_at"] = datetime.now(timezone.utc).isoformat()
        _write_json_atomic(index_path, index)
        return index["orchestrator"]

    # Search team files
    for team_entry in index.get("teams", []):
        team_path = _team_file_path(working_dir, team_entry["id"])
        if not os.path.exists(team_path):
            continue
        _invalidate_cache(team_path)
        with open(team_path, "r") as f:
            team_data = json.load(f)
        for i, member in enumerate(team_data.get("members", [])):
            if member["id"] == registry_id:
                team_data["members"][i] = {**member, **updates}
                _write_json_atomic(team_path, team_data)
                _touch_index_timestamp(working_dir)
                return team_data["members"][i]

    raise ValueError(f"Agent with id '{registry_id}' not found")


def archive_agent(working_dir: str, registry_id: str) -> dict[str, Any]:
    """Set an agent's status to 'archived'."""
    return update_agent(working_dir, registry_id, {"status": "archived"})


# ─── Team Management ─────────────────────────────────────────────

TEAM_COLORS = [
    "#FF6B6B",  # Coral Red
    "#4ECDC4",  # Teal
    "#FFE66D",  # Yellow
    "#A78BFA",  # Purple
    "#F97316",  # Orange
    "#38BDF8",  # Sky Blue
    "#FB7185",  # Pink
    "#34D399",  # Emerald
]


def _next_available_color(working_dir: str) -> str:
    """Return the first team color not already used by an existing team."""
    index = load_teams_index(working_dir)
    used = {t.get("color") for t in index.get("teams", [])}
    for color in TEAM_COLORS:
        if color not in used:
            return color
    # All used — cycle back to the first
    return TEAM_COLORS[0]


def get_teams(working_dir: str) -> list[dict[str, Any]]:
    """Return all teams (excluding unassigned, for backward compat)."""
    registry = load_registry(working_dir)
    return registry.get("teams", [])


def get_team_by_id(working_dir: str, team_id: str) -> dict[str, Any] | None:
    """Find a team by ID."""
    index = load_teams_index(working_dir)
    for team in index.get("teams", []):
        if team["id"] == team_id:
            return team
    return None


def get_team_by_name(working_dir: str, name: str) -> dict[str, Any] | None:
    """Find a team by name (case-insensitive)."""
    index = load_teams_index(working_dir)
    name_lower = name.lower()
    for team in index.get("teams", []):
        if team.get("name", "").lower() == name_lower:
            return team
    return None


def create_team(
    working_dir: str,
    name: str,
    color: str | None = None,
    icon: str | None = None,
) -> dict[str, Any]:
    """Create a new team. Auto-assigns a color if none provided.

    Creates both an entry in teams.json AND a new team-{id}.json file.
    """
    index_path = _teams_index_path(working_dir)
    if not os.path.exists(index_path):
        load_registry(working_dir)  # trigger bootstrap

    _invalidate_cache(index_path)
    with open(index_path, "r") as f:
        index = json.load(f)

    # Check name uniqueness
    name_lower = name.lower()
    for existing in index.get("teams", []):
        if existing.get("name", "").lower() == name_lower:
            raise ValueError(f"Team with name '{name}' already exists")

    if not color:
        color = _next_available_color(working_dir)

    team_id = f"team-{uuid.uuid4().hex[:12]}"
    created_at = datetime.now(timezone.utc).isoformat()

    icon = icon or "Users"

    # Add to index
    team_index_entry = {
        "id": team_id,
        "name": name,
        "color": color,
        "icon": icon,
        "file": f"teams/{team_id}.json",
    }
    if "teams" not in index:
        index["teams"] = []
    index["teams"].append(team_index_entry)
    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_json_atomic(index_path, index)

    # Create the team file
    team_file_data = {
        "id": team_id,
        "name": name,
        "color": color,
        "icon": icon,
        "workflows": [],
        "delegation_notes": "",
        "members": [],
        "created_at": created_at,
    }
    _write_json_atomic(_team_file_path(working_dir, team_id), team_file_data)

    return {
        "id": team_id,
        "name": name,
        "color": color,
        "icon": icon,
        "created_at": created_at,
    }


def update_team(
    working_dir: str, team_id: str, updates: dict[str, Any]
) -> dict[str, Any]:
    """Partial update of a team's configuration.

    Updates both the index entry in teams.json and the team file.
    """
    # Prevent updating protected fields
    protected = {"id", "created_at"}
    updates = {k: v for k, v in updates.items() if k not in protected}

    # Update index entry
    index_path = _teams_index_path(working_dir)
    _invalidate_cache(index_path)
    with open(index_path, "r") as f:
        index = json.load(f)

    found = False
    for i, team in enumerate(index.get("teams", [])):
        if team["id"] == team_id:
            # Only update fields that exist in the index (name, color, icon)
            if "name" in updates:
                index["teams"][i]["name"] = updates["name"]
            if "color" in updates:
                index["teams"][i]["color"] = updates["color"]
            if "icon" in updates:
                index["teams"][i]["icon"] = updates["icon"]
            found = True
            break

    if not found:
        raise ValueError(f"Team with id '{team_id}' not found")

    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_json_atomic(index_path, index)

    # Update team file
    team_path = _team_file_path(working_dir, team_id)
    if os.path.exists(team_path):
        _invalidate_cache(team_path)
        with open(team_path, "r") as f:
            team_data = json.load(f)
        team_data.update(updates)
        _write_json_atomic(team_path, team_data)
        return team_data

    return index["teams"][i]


def delete_team(working_dir: str, team_id: str) -> bool:
    """Delete a team: move members to unassigned, remove team file, remove from index."""
    index_path = _teams_index_path(working_dir)
    _invalidate_cache(index_path)
    with open(index_path, "r") as f:
        index = json.load(f)

    teams = index.get("teams", [])
    new_teams = [t for t in teams if t["id"] != team_id]
    if len(new_teams) == len(teams):
        raise ValueError(f"Team with id '{team_id}' not found")

    # Move members to unassigned
    team_path = _team_file_path(working_dir, team_id)
    if os.path.exists(team_path):
        _invalidate_cache(team_path)
        with open(team_path, "r") as f:
            team_data = json.load(f)
        members = team_data.get("members", [])

        if members:
            unassigned_path = _team_file_path(working_dir, "team-unassigned")
            _invalidate_cache(unassigned_path)
            with open(unassigned_path, "r") as f:
                unassigned = json.load(f)
            unassigned["members"].extend(members)
            _write_json_atomic(unassigned_path, unassigned)

        # Remove team file
        os.remove(team_path)
        _invalidate_cache(team_path)

    # Update index
    index["teams"] = new_teams
    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_json_atomic(index_path, index)

    return True


def assign_agent_to_team(
    working_dir: str, agent_id: str, team_id: str
) -> dict[str, Any]:
    """Assign an agent to a team. Physically moves the member entry between team files."""
    index_path = _teams_index_path(working_dir)
    _invalidate_cache(index_path)
    with open(index_path, "r") as f:
        index = json.load(f)

    # Validate target team exists
    target_team = None
    for t in index.get("teams", []):
        if t["id"] == team_id:
            target_team = t
            break
    if not target_team:
        raise ValueError(f"Team with id '{team_id}' not found")

    # Find and remove agent from their current team file
    agent_entry = None
    for team_entry in index.get("teams", []):
        source_path = _team_file_path(working_dir, team_entry["id"])
        if not os.path.exists(source_path):
            continue
        _invalidate_cache(source_path)
        with open(source_path, "r") as f:
            source_data = json.load(f)
        for i, member in enumerate(source_data.get("members", [])):
            if member["id"] == agent_id:
                agent_entry = source_data["members"].pop(i)
                _write_json_atomic(source_path, source_data)
                break
        if agent_entry:
            break

    if not agent_entry:
        raise ValueError(f"Agent with id '{agent_id}' not found")

    # Add to target team file
    target_path = _team_file_path(working_dir, team_id)
    if not os.path.exists(target_path):
        raise ValueError(f"Team file not found for team '{team_id}'")
    _invalidate_cache(target_path)
    with open(target_path, "r") as f:
        target_data = json.load(f)
    target_data["members"].append(agent_entry)
    _write_json_atomic(target_path, target_data)

    # Update index timestamp
    _touch_index_timestamp(working_dir)

    # Return the agent with team field set
    result = {**agent_entry, "team": team_id}
    return result


def remove_agent_from_team(working_dir: str, agent_id: str) -> dict[str, Any]:
    """Remove an agent from their current team → moves to unassigned."""
    return assign_agent_to_team(working_dir, agent_id, "team-unassigned")


def get_team_members(working_dir: str, team_id: str) -> list[dict[str, Any]]:
    """Return all agents in a specific team by reading the team file directly."""
    team_path = _team_file_path(working_dir, team_id)
    if not os.path.exists(team_path):
        return []
    team_data = _read_json_cached(team_path)
    return team_data.get("members", [])


# ─── Avatar Management ───────────────────────────────────────────

def get_used_avatars(working_dir: str) -> set[str]:
    """Collect all avatar paths currently in use by active/paused agents."""
    registry = load_registry(working_dir)
    used: set[str] = set()

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
    Scan frontend/public/avatars/{gender}/ for image files (.jpeg, .jpg, .png, .webp),
    find ones not already assigned, and return a random unused avatar path.
    Returns None if no avatars are available.
    """
    # Navigate from working dir to frontend/public/avatars
    project_root = os.path.dirname(working_dir)
    avatars_dir = os.path.join(project_root, "frontend", "public", "avatars", gender)

    if not os.path.isdir(avatars_dir):
        return None

    # Find all supported image files
    available = []
    for filename in os.listdir(avatars_dir):
        if filename.lower().endswith((".jpeg", ".jpg", ".png", ".webp")):
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
