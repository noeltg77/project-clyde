"""
Migration Service — converts old registry.json + Clyde prompt to the new
distributed team file architecture, using Haiku to optimise the prompt
and extract workflows into standalone JSON files.
"""

import json
import logging
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from typing import Any

import anthropic

from services.registry import _write_json_atomic, _teams_index_path, _team_file_path

logger = logging.getLogger(__name__)

WORKFLOW_EXAMPLE = """{
  "id": "web-feature-development",
  "name": "Web Feature Development",
  "description": "Standard workflow for building and shipping a new feature on the Clyde website.",
  "created_at": "2025-01-15T09:00:00Z",
  "version": 1,
  "team": "Engineering",
  "stages": [
    {
      "stage": 1,
      "name": "Build",
      "agent": "Olivia",
      "action": "Implement the feature — UI components, styling, and any frontend logic",
      "inputs": ["user brief", "design spec if available"],
      "outputs": ["implemented components", "updated pages"],
      "blocking": true
    },
    {
      "stage": 2,
      "name": "Backend",
      "agent": "George",
      "action": "Implement any API routes, database changes, or server-side logic required",
      "inputs": ["Olivia's frontend output", "user brief"],
      "outputs": ["API routes", "database schema changes", "auth logic"],
      "blocking": true
    },
    {
      "stage": 3,
      "name": "QA",
      "agent": "Arthur",
      "action": "Review all output, write tests, verify build passes, check accessibility",
      "inputs": ["Olivia's output", "George's output"],
      "outputs": ["test suite", "QA report", "sign-off or list of issues"],
      "blocking": true
    }
  ],
  "rules": [
    "Never skip the QA stage",
    "Arthur reviews both frontend and backend output together — do not send partial work",
    "If Arthur raises issues, return to the relevant agent for fixes before re-QA",
    "Do not present output to the user until Arthur has signed off"
  ],
  "on_failure": "If any stage fails or raises blockers, report back to the user before proceeding"
}"""


def _get_anthropic_client() -> anthropic.Anthropic:
    """Create an Anthropic client, raising a clear error if the key is missing."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY is not set. Please configure it in Settings > System."
        )
    return anthropic.Anthropic(api_key=api_key)


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


# ─── Workflow Extraction (AI-powered via Haiku) ──────────────────

def extract_workflows(old_prompt: str) -> list[dict[str, Any]]:
    """Use Haiku to extract any workflow / process definitions from the old prompt.

    Looks for multi-step delegation chains, stage-based processes, or any
    structured instructions that describe how agents should work together
    in sequence. Returns a list of workflow JSON objects matching the
    canonical workflow file structure. Returns an empty list if no
    workflows are found.
    """
    client = _get_anthropic_client()

    system_instruction = f"""You are a workflow extraction assistant. Your job is to find workflow definitions embedded in an AI agent system prompt and convert them into structured JSON.

A "workflow" is any multi-step process that describes:
- A sequence of stages where different agents handle different parts of a task
- A delegation chain (e.g. "First Agent A does X, then Agent B does Y, then Agent C reviews")
- Standing instructions for how a type of task should flow through the team
- Any process with defined stages, inputs, outputs, or ordering rules

Here is the EXACT JSON structure each extracted workflow must follow:

{WORKFLOW_EXAMPLE}

Rules:
1. Search the entire prompt for anything that looks like a workflow, process, or delegation chain.
2. Convert each one into the JSON structure shown above.
3. Generate a kebab-case `id` from the workflow name (e.g. "Content Review Process" → "content-review-process").
4. If agent names are mentioned in the workflow steps, use them in the `agent` field. If no specific agent is named, use "Unassigned".
5. Set `created_at` to the current ISO timestamp.
6. Set `version` to 1.
7. Infer `team` from context if possible, otherwise use "General".
8. Extract any rules or constraints mentioned alongside the workflow into the `rules` array.
9. If the prompt contains NO workflow-like content at all, return an empty JSON array: []
10. Return ONLY a valid JSON array of workflow objects. No explanation, no markdown code fences, no commentary.
11. Do NOT invent workflows — only extract what is genuinely present in the prompt."""

    user_message = f"""Extract all workflows from this system prompt:

{old_prompt}

Return a JSON array of workflow objects (or [] if none found)."""

    logger.info("[MIGRATION] Calling Haiku to extract workflows...")

    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=8192,
        system=system_instruction,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()

    # Strip markdown code fences if Haiku wrapped the output
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*\n?", "", raw)
        raw = re.sub(r"\n?```\s*$", "", raw)

    try:
        workflows = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("[MIGRATION] Haiku returned invalid JSON for workflows, skipping extraction")
        return []

    if not isinstance(workflows, list):
        logger.warning("[MIGRATION] Haiku returned non-array for workflows, skipping extraction")
        return []

    # Stamp created_at on any workflows missing it
    now_iso = datetime.now(timezone.utc).isoformat()
    for wf in workflows:
        if not wf.get("created_at"):
            wf["created_at"] = now_iso
        if not wf.get("version"):
            wf["version"] = 1

    logger.info(f"[MIGRATION] Extracted {len(workflows)} workflow(s) from old prompt")
    return workflows


# ─── Prompt Optimisation (AI-powered via Haiku) ──────────────────

def optimise_prompt(old_prompt: str, reference_prompt: str) -> str:
    """Use Haiku to update an old Clyde prompt to align with the latest version.

    Preserves custom user instructions while adopting the new structure.
    Removes any workflow/process definitions from the prompt (they are now
    stored as separate workflow JSON files).
    """
    client = _get_anthropic_client()

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
7. IMPORTANT — REMOVE all workflow / process definitions from the output. Workflows are multi-step delegation chains that describe how agents should work together in sequence (e.g. "Step 1: Agent A does X, Step 2: Agent B does Y"). These are now stored as separate JSON files in the /working/workflows/ directory and must NOT appear in the system prompt. Remove the entire section or paragraph containing each workflow, but preserve any non-workflow rules that were alongside them.
8. Return ONLY the merged prompt text. No explanations, no markdown code fences, no commentary."""

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
    """Run the full migration: convert registry data + optimise prompt + extract workflows.

    1. Back up current state
    2. Convert registry → team files
    3. Extract workflows from old prompt via Haiku
    4. Optimise prompt via Haiku (strips workflows)
    5. Write all files to disk
    6. Return summary
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

    # Backup workflows directory
    workflows_dir = os.path.join(working_dir, "workflows")
    if os.path.isdir(workflows_dir):
        workflows_backup = os.path.join(backup_dir, "workflows")
        os.makedirs(workflows_backup, exist_ok=True)
        for fname in os.listdir(workflows_dir):
            src = os.path.join(workflows_dir, fname)
            if os.path.isfile(src) and fname.endswith(".json"):
                shutil.copy2(src, os.path.join(workflows_backup, fname))

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

    # Step 3: Extract workflows from old prompt
    workflows = extract_workflows(old_prompt)

    # Step 4: Optimise prompt via Haiku (also strips workflow content)
    reference_prompt_path = os.path.join(working_dir, "prompts", "clyde-system.md")
    with open(reference_prompt_path, "r") as f:
        reference_prompt = f.read()

    optimised_prompt = optimise_prompt(old_prompt, reference_prompt)

    # Step 5: Write all files to disk

    # Write team files
    os.makedirs(teams_dir, exist_ok=True)
    _write_json_atomic(_teams_index_path(working_dir), teams_index)

    for filename, team_data in team_files.items():
        team_id = team_data["id"]
        _write_json_atomic(_team_file_path(working_dir, team_id), team_data)

    # Write workflow files
    os.makedirs(workflows_dir, exist_ok=True)
    for wf in workflows:
        wf_id = wf.get("id", f"workflow-{uuid.uuid4().hex[:8]}")
        wf_path = os.path.join(workflows_dir, f"{wf_id}.json")
        _write_json_atomic(wf_path, wf)

    # Write optimised prompt
    with open(prompt_path, "w") as f:
        f.write(optimised_prompt)

    logger.info(
        f"[MIGRATION] Complete: {stats['teams_created']} teams, "
        f"{stats['agents_migrated']} agents, "
        f"{len(workflows)} workflows migrated"
    )

    return {
        "success": True,
        "teams_created": stats["teams_created"],
        "agents_migrated": stats["agents_migrated"],
        "workflows_extracted": len(workflows),
        "prompt_updated": True,
        "prompt_length": len(optimised_prompt),
        "backup_dir": backup_dir,
    }
