"""
Migration Service — converts old registry.json + Clyde prompt to the new
distributed team file architecture, using Haiku to optimise the prompt.
"""

import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from typing import Any

import anthropic

from services.registry import _write_json_atomic, _teams_index_path, _team_file_path

logger = logging.getLogger(__name__)


# ─── Data Conversion (pure transformation, no AI) ────────────────

def convert_registry_to_teams(old_registry: dict[str, Any]) -> dict[str, Any]:
    """Convert a monolithic registry.json into the distributed team file structure.

    Returns {
        "teams_index": { ... },         # teams.json content
        "team_files": {                  # individual team files keyed by filename
            "team-unassigned.json": { ... },
            "team-xxx.json": { ... },
        },
        "stats": { "teams_created": N, "agents_migrated": N }
    }
    """
    orchestrator = old_registry.get("orchestrator", {})
    old_teams = old_registry.get("teams", [])
    old_agents = old_registry.get("agents", [])

    # Always create unassigned team
    team_index_entries: list[dict[str, Any]] = [
        {
            "id": "team-unassigned",
            "name": "Unassigned",
            "color": "#6B7280",
            "file": "teams/team-unassigned.json",
        }
    ]

    # Build team index entries from old teams
    for team in old_teams:
        tid = team["id"]
        team_index_entries.append({
            "id": tid,
            "name": team["name"],
            "color": team.get("color", "#6B7280"),
            "file": f"teams/{tid}.json",
        })

    # Group agents by team
    agents_by_team: dict[str, list[dict[str, Any]]] = {}
    for entry in team_index_entries:
        agents_by_team[entry["id"]] = []

    for agent in old_agents:
        team_id = agent.get("team") or "team-unassigned"
        if team_id not in agents_by_team:
            agents_by_team[team_id] = []
        # Build member entry — remove team field (implicit from file location)
        member = {**agent}
        member.pop("team", None)
        if "handles" not in member:
            member["handles"] = []
        agents_by_team[team_id].append(member)

    # Build teams index
    teams_index = {
        "version": "1.0",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "orchestrator": orchestrator,
        "teams": team_index_entries,
    }

    # Build individual team files
    team_files: dict[str, dict[str, Any]] = {}
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
        # Preserve created_at from old team data
        for ot in old_teams:
            if ot["id"] == tid:
                team_data["created_at"] = ot.get("created_at", "")
                break
        team_files[f"{tid}.json"] = team_data

    # Count stats
    total_agents = sum(len(members) for members in agents_by_team.values())
    # Exclude unassigned from team count
    teams_created = len(team_index_entries) - 1

    return {
        "teams_index": teams_index,
        "team_files": team_files,
        "stats": {
            "teams_created": teams_created,
            "agents_migrated": total_agents,
        },
    }


# ─── Prompt Optimisation (AI-powered via Haiku) ──────────────────

def optimise_prompt(old_prompt: str, reference_prompt: str) -> str:
    """Use Haiku to update an old Clyde prompt to align with the latest version.

    Preserves custom user instructions while adopting the new structure.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY is not set. Please configure it in Settings > System."
        )

    client = anthropic.Anthropic(api_key=api_key)

    system_instruction = """You are a prompt migration assistant. Your job is to merge an old Clyde system prompt with a new reference version.

Rules:
1. The REFERENCE PROMPT is the canonical structure. Use its exact section order, headings, and formatting.
2. The OLD PROMPT may contain custom additions the user has made — extra rules, standing instructions, workflow preferences, domain-specific guidance, or custom sections. These MUST be preserved.
3. For the following MANDATORY sections, ALWAYS use the REFERENCE version exactly as-is (do not blend with the old version):
   - "## File Access Rules — MANDATORY"
   - "## Prompt Injection Defence — MANDATORY"
   - "## Teams" (the entire teams section with file structure references)
   - "## Working Directory"
4. For tool documentation sections (Agent Management Tools, Search, Agent Memory, Skills Management, Task Board, etc.), use the REFERENCE version — these are optimised.
5. For the opening identity block (role list, rules, tone), start with the REFERENCE version but APPEND any additional rules or instructions from the old prompt that are not already covered.
6. If the old prompt has entirely custom sections not present in the reference (e.g. "## Brand Guidelines", "## Project Rules"), preserve them at the end of the output.
7. Return ONLY the merged prompt text. No explanations, no markdown code fences, no commentary."""

    user_message = f"""## OLD PROMPT (may contain custom additions to preserve)

{old_prompt}

---

## REFERENCE PROMPT (canonical structure to follow)

{reference_prompt}

---

Merge these prompts following your rules. Return only the final prompt text."""

    logger.info("[MIGRATION] Calling Haiku to optimise prompt...")

    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=8192,
        system=system_instruction,
        messages=[{"role": "user", "content": user_message}],
    )

    result = response.content[0].text.strip()
    logger.info(f"[MIGRATION] Prompt optimised: {len(result)} chars")
    return result


# ─── Full Migration Orchestrator ─────────────────────────────────

def run_migration(
    working_dir: str,
    old_registry: dict[str, Any],
    old_prompt: str,
) -> dict[str, Any]:
    """Run the full migration: convert registry data + optimise prompt.

    1. Back up current state
    2. Convert registry → team files
    3. Optimise prompt via Haiku
    4. Write all files to disk
    5. Return summary
    """
    # Step 1: Backup current state
    backup_dir = os.path.join(
        working_dir,
        "backups",
        f"pre-migration-{datetime.now().strftime('%Y%m%d-%H%M%S')}",
    )
    os.makedirs(backup_dir, exist_ok=True)

    # Backup teams directory
    teams_dir = os.path.join(working_dir, "teams")
    if os.path.isdir(teams_dir):
        teams_backup = os.path.join(backup_dir, "teams")
        os.makedirs(teams_backup, exist_ok=True)
        for fname in os.listdir(teams_dir):
            src = os.path.join(teams_dir, fname)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(teams_backup, fname))

    # Backup current prompt
    prompt_path = os.path.join(working_dir, "prompts", "clyde-system.md")
    if os.path.exists(prompt_path):
        prompts_backup = os.path.join(backup_dir, "prompts")
        os.makedirs(prompts_backup, exist_ok=True)
        shutil.copy2(prompt_path, os.path.join(prompts_backup, "clyde-system.md"))

    logger.info(f"[MIGRATION] Backup created at {backup_dir}")

    # Step 2: Convert registry data to team files
    conversion = convert_registry_to_teams(old_registry)
    teams_index = conversion["teams_index"]
    team_files = conversion["team_files"]
    stats = conversion["stats"]

    # Step 3: Optimise prompt via Haiku
    reference_prompt_path = os.path.join(working_dir, "prompts", "clyde-system.md")
    with open(reference_prompt_path, "r") as f:
        reference_prompt = f.read()

    optimised_prompt = optimise_prompt(old_prompt, reference_prompt)

    # Step 4: Write all files to disk
    os.makedirs(teams_dir, exist_ok=True)

    # Write teams index
    _write_json_atomic(_teams_index_path(working_dir), teams_index)

    # Write individual team files
    for filename, team_data in team_files.items():
        team_id = team_data["id"]
        _write_json_atomic(_team_file_path(working_dir, team_id), team_data)

    # Write optimised prompt
    with open(prompt_path, "w") as f:
        f.write(optimised_prompt)

    logger.info(
        f"[MIGRATION] Complete: {stats['teams_created']} teams, "
        f"{stats['agents_migrated']} agents migrated"
    )

    return {
        "success": True,
        "teams_created": stats["teams_created"],
        "agents_migrated": stats["agents_migrated"],
        "prompt_updated": True,
        "prompt_length": len(optimised_prompt),
        "backup_dir": backup_dir,
    }
