"""
Custom MCP tools for Clyde — Agent Registry Management, Search, Memory, and Skills.

These tools are exposed to Clyde via an in-process MCP server,
allowing Clyde to create, list, update, and inspect subagents,
search chat history, manage agent memory, and handle skills.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from claude_agent_sdk import tool, create_sdk_mcp_server

from services.registry import (
    load_registry,
    save_registry,
    create_agent,
    update_agent,
    get_agent_by_name,
    get_agent_by_id,
    get_active_agents,
)
from services.embeddings import generate_query_embedding
from services.supabase_client import search_messages

# Module-level working_dir — set by init_tools() before server is used
_working_dir: str = ""


def init_tools(working_dir: str) -> None:
    """Set the working directory for all tool functions."""
    global _working_dir
    _working_dir = working_dir


def _safe_path(relative_or_virtual: str) -> str:
    """Resolve a path and ensure it stays within _working_dir.

    Accepts:
      - Relative paths like "skills/my-skill.md"
      - Virtual paths like "/working/skills/my-skill.md"
      - Paths with ".." traversal (rejected)

    Returns the absolute path as a string.
    Raises ValueError if the resolved path escapes _working_dir.
    """
    working = Path(_working_dir).resolve()
    # Strip virtual /working/ prefix if present
    cleaned = relative_or_virtual.replace("/working/", "", 1).lstrip("/")
    target = (working / cleaned).resolve()
    if not str(target).startswith(str(working)):
        raise ValueError(
            f"Path blocked: '{relative_or_virtual}' resolves outside the working directory. "
            f"All file operations must stay within {_working_dir}"
        )
    return str(target)


def _text_response(text: str) -> dict[str, Any]:
    """Helper to build a standard text response."""
    return {"content": [{"type": "text", "text": text}]}


def _error_response(text: str) -> dict[str, Any]:
    """Helper to build an error response."""
    return {"content": [{"type": "text", "text": text}], "is_error": True}


# ─── Agent Registry Tools (Phase 2) ──────────────────────────────


@tool(
    "create_agent",
    "Create a new subagent in the registry. Writes the system prompt to file, "
    "initialises memory, creates a working directory, selects an avatar, and "
    "registers the agent. Returns the new agent's details.",
    {
        "name": str,
        "role": str,
        "model": str,
        "gender": str,
        "system_prompt": str,
        "tools": str,
    },
)
async def create_agent_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new subagent."""
    try:
        name = args.get("name", "").strip()
        role = args.get("role", "").strip()
        model = args.get("model", "sonnet").strip().lower()
        gender = args.get("gender", "male").strip().lower()
        system_prompt = args.get("system_prompt", "").strip()
        tools_str = args.get("tools", "")

        if not name:
            return _error_response("Agent name is required.")
        if not role:
            return _error_response("Agent role is required.")
        if not system_prompt:
            return _error_response("System prompt is required.")
        if model not in ("sonnet", "haiku", "opus"):
            return _error_response(f"Invalid model '{model}'. Must be sonnet, haiku, or opus.")
        if gender not in ("male", "female"):
            return _error_response(f"Invalid gender '{gender}'. Must be male or female.")

        # Parse tools — accept comma-separated string or JSON array
        tools_list = None
        if tools_str:
            try:
                tools_list = json.loads(tools_str)
            except json.JSONDecodeError:
                tools_list = [t.strip() for t in tools_str.split(",") if t.strip()]

        agent_entry = create_agent(
            working_dir=_working_dir,
            name=name,
            role=role,
            model=model,
            system_prompt=system_prompt,
            tools=tools_list,
            gender=gender,
        )

        return _text_response(
            f"Successfully created agent:\n"
            f"  Name: {agent_entry['name']}\n"
            f"  ID: {agent_entry['id']}\n"
            f"  Role: {agent_entry['role']}\n"
            f"  Model: {agent_entry['model']}\n"
            f"  Avatar: {agent_entry.get('avatar', 'none')}\n"
            f"  Prompt: {agent_entry['system_prompt_path']}\n"
            f"  Memory: {agent_entry.get('memory_path', '')}\n"
            f"  Working dir: {agent_entry.get('working_dir', '')}\n"
            f"  Tools: {', '.join(agent_entry.get('tools', []))}"
        )

    except ValueError as e:
        return _error_response(str(e))
    except Exception as e:
        return _error_response(f"Failed to create agent: {str(e)}")


@tool(
    "list_agents",
    "List all agents in the registry with their status, role, model, and ID. "
    "Optionally filter by status (active, paused, archived, or all).",
    {"status_filter": str},
)
async def list_agents_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List agents from the registry."""
    try:
        registry = load_registry(_working_dir)
        agents = registry.get("agents", [])
        status_filter = args.get("status_filter", "all").strip().lower()

        if status_filter != "all":
            agents = [a for a in agents if a.get("status") == status_filter]

        if not agents:
            return _text_response(f"No agents found (filter: {status_filter}).")

        lines = [f"Agents ({len(agents)} total, filter: {status_filter}):\n"]
        for a in agents:
            lines.append(
                f"  - {a['name']} ({a['id']})\n"
                f"    Role: {a['role']}\n"
                f"    Model: {a.get('model', 'sonnet')}\n"
                f"    Status: {a.get('status', 'active')}\n"
                f"    Tools: {', '.join(a.get('tools', []))}\n"
                f"    Skills: {', '.join(a.get('skills', []))}"
            )

        return _text_response("\n".join(lines))

    except Exception as e:
        return _error_response(f"Failed to list agents: {str(e)}")


@tool(
    "update_agent",
    "Update an existing agent's configuration. Can change role, model, status, "
    "tools, or skills. Specify the agent by name or ID.",
    {
        "agent_name_or_id": str,
        "role": str,
        "model": str,
        "status": str,
        "tools": str,
        "skills": str,
    },
)
async def update_agent_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Update an agent's configuration."""
    try:
        identifier = args.get("agent_name_or_id", "").strip()
        if not identifier:
            return _error_response("agent_name_or_id is required.")

        # Find agent by name or ID
        agent = get_agent_by_name(_working_dir, identifier)
        if not agent:
            agent = get_agent_by_id(_working_dir, identifier)
        if not agent:
            return _error_response(f"Agent '{identifier}' not found.")

        # Build updates dict from provided fields
        updates: dict[str, Any] = {}

        role = args.get("role", "").strip()
        if role:
            updates["role"] = role

        model = args.get("model", "").strip().lower()
        if model:
            if model not in ("sonnet", "haiku", "opus"):
                return _error_response(f"Invalid model '{model}'.")
            updates["model"] = model

        status = args.get("status", "").strip().lower()
        if status:
            if status not in ("active", "paused", "archived"):
                return _error_response(f"Invalid status '{status}'.")
            updates["status"] = status

        tools_str = args.get("tools", "").strip()
        if tools_str:
            try:
                updates["tools"] = json.loads(tools_str)
            except json.JSONDecodeError:
                updates["tools"] = [t.strip() for t in tools_str.split(",") if t.strip()]

        skills_str = args.get("skills", "").strip()
        if skills_str:
            try:
                updates["skills"] = json.loads(skills_str)
            except json.JSONDecodeError:
                updates["skills"] = [s.strip() for s in skills_str.split(",") if s.strip()]

        if not updates:
            return _error_response("No updates provided.")

        updated = update_agent(_working_dir, agent["id"], updates)
        return _text_response(
            f"Updated agent {updated['name']} ({updated['id']}):\n"
            + "\n".join(f"  {k}: {v}" for k, v in updates.items())
        )

    except ValueError as e:
        return _error_response(str(e))
    except Exception as e:
        return _error_response(f"Failed to update agent: {str(e)}")


@tool(
    "get_agent_details",
    "Get full details of a specific agent including their system prompt content, "
    "memory path, working directory, tools, and skills.",
    {"agent_name_or_id": str},
)
async def get_agent_details_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Get detailed info about a specific agent."""
    try:
        identifier = args.get("agent_name_or_id", "").strip()
        if not identifier:
            return _error_response("agent_name_or_id is required.")

        agent = get_agent_by_name(_working_dir, identifier)
        if not agent:
            agent = get_agent_by_id(_working_dir, identifier)
        if not agent:
            return _error_response(f"Agent '{identifier}' not found.")

        # Load system prompt content
        prompt_content = "(not found)"
        prompt_rel = agent.get("system_prompt_path", "")
        if prompt_rel:
            try:
                prompt_abs = _safe_path(prompt_rel)
                if os.path.exists(prompt_abs):
                    with open(prompt_abs, "r") as f:
                        prompt_content = f.read()
            except ValueError:
                prompt_content = "(path blocked — outside working directory)"

        return _text_response(
            f"Agent: {agent['name']} ({agent['id']})\n"
            f"Role: {agent['role']}\n"
            f"Model: {agent.get('model', 'sonnet')}\n"
            f"Status: {agent.get('status', 'active')}\n"
            f"Avatar: {agent.get('avatar', 'none')}\n"
            f"Tools: {', '.join(agent.get('tools', []))}\n"
            f"Skills: {', '.join(agent.get('skills', []))}\n"
            f"Working dir: {agent.get('working_dir', '')}\n"
            f"Memory: {agent.get('memory_path', '')}\n"
            f"\n--- System Prompt ---\n{prompt_content}"
        )

    except Exception as e:
        return _error_response(f"Failed to get agent details: {str(e)}")


# ─── Search Tools (Phase 3B) ──────────────────────────────────────


@tool(
    "search_history",
    "Search past conversations for relevant context using semantic similarity. "
    "Use this when the user references something discussed before, or you need "
    "historical context for a task.",
    {"query": str},
)
async def search_history_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Search vectorised chat history for relevant context."""
    try:
        query = args.get("query", "").strip()
        if not query:
            return _error_response("Search query is required.")

        # Generate embedding for the search query
        embedding = await generate_query_embedding(query)

        # Search Supabase vector store
        results = await search_messages(
            query_embedding=embedding,
            threshold=0.5,
            limit=5,
        )

        if not results:
            return _text_response(f"No relevant results found for: \"{query}\"")

        lines = [f"Search results for \"{query}\" ({len(results)} matches):\n"]
        for i, r in enumerate(results, 1):
            content = (r.get("content") or "")[:300]
            role = r.get("role", "unknown")
            agent_name = r.get("agent_name") or role.capitalize()
            similarity = r.get("similarity", 0)
            created_at = r.get("created_at", "")[:19]  # trim to seconds
            session_id = r.get("session_id", "")[:8]  # short ID

            lines.append(
                f"  [{i}] (similarity: {similarity:.2f}, session: {session_id}...)\n"
                f"      {agent_name} ({created_at}):\n"
                f"      {content}\n"
            )

        return _text_response("\n".join(lines))

    except Exception as e:
        return _error_response(f"Search failed: {str(e)}")


# ─── Memory Tools (Phase 3C) ──────────────────────────────────────


@tool(
    "read_agent_memory",
    "Read an agent's accumulated memory file. Memory contains lessons learned, "
    "preferences, and patterns from previous tasks.",
    {"agent_name": str},
)
async def read_agent_memory_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Read an agent's memory file."""
    try:
        agent_name = args.get("agent_name", "").strip()
        if not agent_name:
            return _error_response("agent_name is required.")

        # Find agent in registry to get memory path
        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found in registry.")

        memory_path = agent.get("memory_path", "")
        if not memory_path:
            return _text_response(f"Agent '{agent_name}' has no memory path configured.")

        # Convert relative path to absolute (with safety check)
        try:
            abs_path = _safe_path(memory_path)
        except ValueError as e:
            return _error_response(str(e))

        if not os.path.exists(abs_path):
            return _text_response(
                f"Memory file for '{agent_name}' does not exist yet at {memory_path}. "
                "Use update_agent_memory to create initial memories."
            )

        with open(abs_path, "r") as f:
            content = f.read()

        if not content.strip():
            return _text_response(f"Memory file for '{agent_name}' is empty. No accumulated knowledge yet.")

        return _text_response(
            f"Memory for {agent_name}:\n"
            f"--- {memory_path} ---\n\n{content}"
        )

    except Exception as e:
        return _error_response(f"Failed to read agent memory: {str(e)}")


@tool(
    "update_agent_memory",
    "Update an agent's memory file with new knowledge. Appends a timestamped "
    "entry with lessons learned, preferences discovered, or patterns that worked well.",
    {"agent_name": str, "content": str},
)
async def update_agent_memory_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Update an agent's memory file by appending new content."""
    try:
        agent_name = args.get("agent_name", "").strip()
        content = args.get("content", "").strip()

        if not agent_name:
            return _error_response("agent_name is required.")
        if not content:
            return _error_response("content is required.")

        # Find agent in registry
        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found in registry.")

        memory_path = agent.get("memory_path", "")
        if not memory_path:
            # Create default memory path
            name_lower = agent_name.lower()
            memory_path = f"/working/memory/{name_lower}-memory.md"
            # Update registry with memory path
            update_agent(_working_dir, agent["id"], {"memory_path": memory_path})

        # Convert relative path to absolute (with safety check)
        try:
            abs_path = _safe_path(memory_path)
        except ValueError as e:
            return _error_response(str(e))

        # Ensure directory exists
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)

        # Build timestamped entry
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        entry = f"\n\n---\n\n### Memory Update — {now}\n\n{content}\n"

        # Append to file (create if doesn't exist)
        existing = ""
        if os.path.exists(abs_path):
            with open(abs_path, "r") as f:
                existing = f.read()

        if not existing.strip():
            # Initialize with header
            header = f"# {agent_name} — Memory\n\nAccumulated knowledge and lessons learned.\n"
            with open(abs_path, "w") as f:
                f.write(header + entry)
        else:
            with open(abs_path, "a") as f:
                f.write(entry)

        return _text_response(
            f"Updated memory for '{agent_name}' at {memory_path}.\n"
            f"Added entry: {content[:100]}..."
        )

    except Exception as e:
        return _error_response(f"Failed to update agent memory: {str(e)}")


# ─── Skills Tools (Phase 3D) ──────────────────────────────────────


@tool(
    "create_skill",
    "Create a new skill document — a reusable process that can be assigned to agents. "
    "Skills are markdown files with description, steps, quality criteria, and examples.",
    {"name": str, "content": str, "assigned_to": str},
)
async def create_skill_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new skill document and optionally assign to an agent."""
    try:
        name = args.get("name", "").strip()
        content = args.get("content", "").strip()
        assigned_to = args.get("assigned_to", "").strip()

        if not name:
            return _error_response("Skill name is required.")
        if not content:
            return _error_response("Skill content is required.")

        # Sanitise name for filename
        filename = name.lower().replace(" ", "-").replace("_", "-")
        try:
            filepath = _safe_path(f"skills/{filename}.md")
        except ValueError as e:
            return _error_response(str(e))

        # Check if skill already exists
        if os.path.exists(filepath):
            return _error_response(
                f"Skill '{name}' already exists at /working/skills/{filename}.md. "
                "Use update_skill to modify it."
            )

        # Ensure skills directory exists
        os.makedirs(os.path.dirname(filepath), exist_ok=True)

        # Build skill document
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        doc = (
            f"# {name}\n\n"
            f"**Version:** 1.0\n"
            f"**Created:** {now}\n"
            f"**Last Updated:** {now}\n\n"
            f"---\n\n"
            f"{content}\n"
        )

        with open(filepath, "w") as f:
            f.write(doc)

        # Assign to agent if specified
        assigned_msg = ""
        if assigned_to:
            agent = get_agent_by_name(_working_dir, assigned_to)
            if agent:
                current_skills = agent.get("skills", [])
                if filename not in current_skills:
                    current_skills.append(filename)
                    update_agent(_working_dir, agent["id"], {"skills": current_skills})
                    assigned_msg = f"\nAssigned to: {assigned_to}"
            else:
                assigned_msg = f"\nWarning: Agent '{assigned_to}' not found, skill not assigned."

        return _text_response(
            f"Created skill '{name}' at /working/skills/{filename}.md (v1.0){assigned_msg}"
        )

    except Exception as e:
        return _error_response(f"Failed to create skill: {str(e)}")


@tool(
    "list_skills",
    "List all available skills with their names, versions, and assigned agents.",
    {},
)
async def list_skills_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List all skill documents."""
    try:
        skills_dir = os.path.join(_working_dir, "skills")
        if not os.path.isdir(skills_dir):
            return _text_response("No skills directory found. No skills have been created yet.")

        files = sorted(f for f in os.listdir(skills_dir) if f.endswith(".md"))
        if not files:
            return _text_response("No skills found in /working/skills/.")

        # Load registry to find assignments (check orchestrator + all agents)
        registry = load_registry(_working_dir)
        skill_agents: dict[str, list[str]] = {}

        # Check orchestrator skills
        orchestrator = registry.get("orchestrator", {})
        for skill_name in orchestrator.get("skills", []):
            skill_agents.setdefault(skill_name, []).append(orchestrator.get("name", "Clyde"))

        for agent in registry.get("agents", []):
            for skill_name in agent.get("skills", []):
                skill_agents.setdefault(skill_name, []).append(agent["name"])

        lines = [f"Skills ({len(files)} total):\n"]
        for fname in files:
            skill_name = fname[:-3]
            fpath = os.path.join(skills_dir, fname)
            with open(fpath, "r") as f:
                first_line = f.readline().strip().lstrip("# ").strip()
                content = f.read()

            # Extract version
            version = "1.0"
            for line in content.split("\n"):
                if line.strip().lower().startswith("**version:**"):
                    version = line.split(":", 1)[1].strip().strip("*")
                    break

            agents_str = ", ".join(skill_agents.get(skill_name, [])) or "unassigned"
            lines.append(
                f"  - {first_line or skill_name} (v{version})\n"
                f"    File: {fname}\n"
                f"    Assigned to: {agents_str}"
            )

        return _text_response("\n".join(lines))

    except Exception as e:
        return _error_response(f"Failed to list skills: {str(e)}")


@tool(
    "read_skill",
    "Read the full content of a skill document.",
    {"name": str},
)
async def read_skill_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Read a skill document."""
    try:
        name = args.get("name", "").strip()
        if not name:
            return _error_response("Skill name is required.")

        # Try exact filename first, then sanitised version
        filename = name if name.endswith(".md") else f"{name}.md"
        try:
            filepath = _safe_path(f"skills/{filename}")
        except ValueError as e:
            return _error_response(str(e))

        if not os.path.exists(filepath):
            # Try sanitised name
            sanitised = name.lower().replace(" ", "-").replace("_", "-")
            try:
                filepath = _safe_path(f"skills/{sanitised}.md")
            except ValueError as e:
                return _error_response(str(e))

        if not os.path.exists(filepath):
            return _error_response(f"Skill '{name}' not found in /working/skills/.")

        with open(filepath, "r") as f:
            content = f.read()

        return _text_response(content)

    except Exception as e:
        return _error_response(f"Failed to read skill: {str(e)}")


@tool(
    "update_skill",
    "Update an existing skill with new content. Creates a new version with "
    "a timestamp and reason for the change.",
    {"name": str, "content": str, "reason": str},
)
async def update_skill_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Update an existing skill document with version increment."""
    try:
        name = args.get("name", "").strip()
        content = args.get("content", "").strip()
        reason = args.get("reason", "").strip()

        if not name:
            return _error_response("Skill name is required.")
        if not content:
            return _error_response("New content is required.")

        # Find the file
        filename = name if name.endswith(".md") else f"{name}.md"
        try:
            filepath = _safe_path(f"skills/{filename}")
        except ValueError as e:
            return _error_response(str(e))

        if not os.path.exists(filepath):
            sanitised = name.lower().replace(" ", "-").replace("_", "-")
            try:
                filepath = _safe_path(f"skills/{sanitised}.md")
            except ValueError as e:
                return _error_response(str(e))

        if not os.path.exists(filepath):
            return _error_response(f"Skill '{name}' not found. Use create_skill to create it.")

        # Read current file to extract version
        with open(filepath, "r") as f:
            old_content = f.read()

        # Extract current version
        current_version = "1.0"
        for line in old_content.split("\n"):
            if line.strip().lower().startswith("**version:**"):
                current_version = line.split(":", 1)[1].strip().strip("*")
                break

        # Increment version
        try:
            major, minor = current_version.split(".")
            new_version = f"{major}.{int(minor) + 1}"
        except (ValueError, IndexError):
            new_version = f"{current_version}.1"

        # Extract title from first line
        first_line = old_content.split("\n")[0].strip().lstrip("# ").strip()

        # Build updated document
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        reason_line = f"\n**Update Reason:** {reason}" if reason else ""
        doc = (
            f"# {first_line}\n\n"
            f"**Version:** {new_version}\n"
            f"**Created:** (see history)\n"
            f"**Last Updated:** {now}{reason_line}\n\n"
            f"---\n\n"
            f"{content}\n\n"
            f"---\n\n"
            f"## Version History\n\n"
            f"- v{new_version} ({now}): {reason or 'Updated'}\n"
            f"- v{current_version}: Previous version\n"
        )

        with open(filepath, "w") as f:
            f.write(doc)

        return _text_response(
            f"Updated skill '{first_line}' from v{current_version} to v{new_version}.\n"
            f"Reason: {reason or 'Not specified'}"
        )

    except Exception as e:
        return _error_response(f"Failed to update skill: {str(e)}")


@tool(
    "assign_skill",
    "Assign a skill to an agent so they have access to the process document during tasks.",
    {"skill_name": str, "agent_name": str},
)
async def assign_skill_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Assign a skill to an agent."""
    try:
        skill_name = args.get("skill_name", "").strip()
        agent_name = args.get("agent_name", "").strip()

        if not skill_name:
            return _error_response("skill_name is required.")
        if not agent_name:
            return _error_response("agent_name is required.")

        # Verify skill exists
        filename = skill_name if skill_name.endswith(".md") else f"{skill_name}.md"
        try:
            filepath = _safe_path(f"skills/{filename}")
        except ValueError as e:
            return _error_response(str(e))
        if not os.path.exists(filepath):
            sanitised = skill_name.lower().replace(" ", "-").replace("_", "-")
            try:
                filepath = _safe_path(f"skills/{sanitised}.md")
            except ValueError as e:
                return _error_response(str(e))
            if not os.path.exists(filepath):
                return _error_response(f"Skill '{skill_name}' not found.")
            skill_name = sanitised

        # Remove .md extension for storage
        skill_key = skill_name.replace(".md", "")

        # Find agent
        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found.")

        # Add skill to agent's skills array
        current_skills = agent.get("skills", [])
        if skill_key in current_skills:
            return _text_response(f"Skill '{skill_key}' is already assigned to {agent_name}.")

        current_skills.append(skill_key)
        update_agent(_working_dir, agent["id"], {"skills": current_skills})

        return _text_response(
            f"Assigned skill '{skill_key}' to {agent_name}.\n"
            f"{agent_name}'s skills: {', '.join(current_skills)}"
        )

    except Exception as e:
        return _error_response(f"Failed to assign skill: {str(e)}")


# ─── Schedule Tools (Phase 4C) ───────────────────────────────────


@tool(
    "create_schedule",
    "Create a new scheduled task that runs automatically on a cron schedule. "
    "The prompt will be sent to Clyde in a new headless session each time it fires.",
    {"name": str, "cron": str, "prompt": str, "agent_name": str},
)
async def create_schedule_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new scheduled task."""
    try:
        from services.scheduler import TaskScheduler

        name = args.get("name", "").strip()
        cron = args.get("cron", "").strip()
        prompt = args.get("prompt", "").strip()
        agent_name = args.get("agent_name", "").strip() or None

        if not name:
            return _error_response("Schedule name is required.")
        if not cron:
            return _error_response("Cron expression is required (e.g. '0 9 * * MON-FRI').")
        if not prompt:
            return _error_response("Prompt is required.")

        scheduler = TaskScheduler(_working_dir)
        schedule = await scheduler.add_schedule(name, cron, prompt, agent_name)

        return _text_response(
            f"Created schedule '{name}':\n"
            f"  ID: {schedule['id']}\n"
            f"  Cron: {cron}\n"
            f"  Agent: {agent_name or 'Clyde (default)'}\n"
            f"  Prompt: {prompt[:100]}..."
        )
    except Exception as e:
        return _error_response(f"Failed to create schedule: {str(e)}")


@tool(
    "list_schedules",
    "List all scheduled tasks with their status, cron expression, and run count.",
    {},
)
async def list_schedules_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List all scheduled tasks."""
    try:
        schedules_path = os.path.join(_working_dir, "schedules.json")
        if not os.path.exists(schedules_path):
            return _text_response("No schedules configured yet.")

        with open(schedules_path, "r") as f:
            data = json.load(f)

        schedules = data.get("schedules", [])
        if not schedules:
            return _text_response("No schedules configured yet.")

        lines = [f"Schedules ({len(schedules)} total):\n"]
        for s in schedules:
            status = "enabled" if s.get("enabled", True) else "paused"
            last_run = s.get("last_run", "never")
            if last_run and last_run != "never":
                last_run = last_run[:19]
            lines.append(
                f"  - {s['name']} ({s['id']})\n"
                f"    Cron: {s['cron']}\n"
                f"    Status: {status}\n"
                f"    Agent: {s.get('agent_name') or 'Clyde'}\n"
                f"    Runs: {s.get('run_count', 0)}\n"
                f"    Last run: {last_run}\n"
                f"    Prompt: {s.get('prompt', '')[:80]}..."
            )

        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to list schedules: {str(e)}")


@tool(
    "delete_schedule",
    "Delete a scheduled task by its ID.",
    {"schedule_id": str},
)
async def delete_schedule_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delete a scheduled task."""
    try:
        from services.scheduler import TaskScheduler

        schedule_id = args.get("schedule_id", "").strip()
        if not schedule_id:
            return _error_response("schedule_id is required.")

        scheduler = TaskScheduler(_working_dir)
        await scheduler.remove_schedule(schedule_id)

        return _text_response(f"Deleted schedule: {schedule_id}")
    except Exception as e:
        return _error_response(f"Failed to delete schedule: {str(e)}")


@tool(
    "pause_schedule",
    "Pause or resume a scheduled task by toggling its enabled state.",
    {"schedule_id": str},
)
async def pause_schedule_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Toggle a schedule's enabled state."""
    try:
        from services.scheduler import TaskScheduler

        schedule_id = args.get("schedule_id", "").strip()
        if not schedule_id:
            return _error_response("schedule_id is required.")

        scheduler = TaskScheduler(_working_dir)
        result = await scheduler.pause_schedule(schedule_id)

        if result:
            # Read back to get current state
            schedules = await scheduler.list_schedules()
            for s in schedules:
                if s["id"] == schedule_id:
                    status = "enabled" if s.get("enabled") else "paused"
                    return _text_response(f"Schedule '{s['name']}' is now {status}.")
            return _text_response(f"Toggled schedule: {schedule_id}")

        return _error_response(f"Schedule '{schedule_id}' not found.")
    except Exception as e:
        return _error_response(f"Failed to pause schedule: {str(e)}")


# ─── Trigger Tools (Phase 4D) ───────────────────────────────────


@tool(
    "create_trigger",
    "Create a file trigger that watches a directory for changes matching a glob pattern. "
    "When a matching file is added or modified, the prompt executes in a new session. "
    "Use {filename} and {change_type} in the prompt as variables.",
    {"name": str, "watch_path": str, "pattern": str, "prompt": str, "agent_name": str},
)
async def create_trigger_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new file trigger."""
    try:
        from services.file_watcher import FileWatcherService

        name = args.get("name", "").strip()
        watch_path = args.get("watch_path", "").strip()
        pattern = args.get("pattern", "").strip()
        prompt = args.get("prompt", "").strip()
        agent_name = args.get("agent_name", "").strip() or None

        if not name:
            return _error_response("Trigger name is required.")
        if not watch_path:
            return _error_response("Watch path is required.")
        if not pattern:
            return _error_response("File pattern is required (e.g. '*.csv').")
        if not prompt:
            return _error_response("Prompt is required. Use {filename} and {change_type} as variables.")

        watcher = FileWatcherService(_working_dir)
        trigger = await watcher.add_trigger(name, watch_path, pattern, prompt, agent_name)

        return _text_response(
            f"Created trigger '{name}':\n"
            f"  ID: {trigger['id']}\n"
            f"  Watch: {trigger['watch_path']}\n"
            f"  Pattern: {pattern}\n"
            f"  Agent: {agent_name or 'Clyde (default)'}\n"
            f"  Prompt: {prompt[:100]}..."
        )
    except Exception as e:
        return _error_response(f"Failed to create trigger: {str(e)}")


@tool(
    "list_triggers",
    "List all file triggers with their watch paths, patterns, and fire counts.",
    {},
)
async def list_triggers_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List all file triggers."""
    try:
        triggers_path = os.path.join(_working_dir, "triggers.json")
        if not os.path.exists(triggers_path):
            return _text_response("No triggers configured yet.")

        with open(triggers_path, "r") as f:
            data = json.load(f)

        triggers = data.get("triggers", [])
        if not triggers:
            return _text_response("No triggers configured yet.")

        lines = [f"Triggers ({len(triggers)} total):\n"]
        for t in triggers:
            status = "enabled" if t.get("enabled", True) else "disabled"
            lines.append(
                f"  - {t['name']} ({t['id']})\n"
                f"    Watch: {t['watch_path']}\n"
                f"    Pattern: {t['pattern']}\n"
                f"    Status: {status}\n"
                f"    Agent: {t.get('agent_name') or 'Clyde'}\n"
                f"    Fires: {t.get('fire_count', 0)}\n"
                f"    Prompt: {t.get('prompt', '')[:80]}..."
            )

        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to list triggers: {str(e)}")


@tool(
    "delete_trigger",
    "Delete a file trigger by its ID.",
    {"trigger_id": str},
)
async def delete_trigger_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delete a file trigger."""
    try:
        from services.file_watcher import FileWatcherService

        trigger_id = args.get("trigger_id", "").strip()
        if not trigger_id:
            return _error_response("trigger_id is required.")

        watcher = FileWatcherService(_working_dir)
        await watcher.remove_trigger(trigger_id)

        return _text_response(f"Deleted trigger: {trigger_id}")
    except Exception as e:
        return _error_response(f"Failed to delete trigger: {str(e)}")


# ─── MCP Server Management Tool (Phase 4E) ──────────────────────


@tool(
    "assign_mcp_server",
    "Assign an external MCP server to an agent. The agent will have access to "
    "the MCP server's tools during tasks. Server config is stored in the registry.",
    {"agent_name": str, "server_name": str, "server_type": str, "command": str},
)
async def assign_mcp_server_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Assign an external MCP server to an agent."""
    try:
        agent_name = args.get("agent_name", "").strip()
        server_name = args.get("server_name", "").strip()
        server_type = args.get("server_type", "stdio").strip()
        command = args.get("command", "").strip()

        if not agent_name:
            return _error_response("agent_name is required.")
        if not server_name:
            return _error_response("server_name is required.")
        if not command:
            return _error_response("command is required (the command to start the MCP server).")

        # Find agent
        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found.")

        # Build MCP server entry
        mcp_entry = {
            "name": server_name,
            "type": server_type,
            "command": command,
        }

        # Update agent's mcp_servers array
        current_servers = agent.get("mcp_servers", [])
        # Replace if server with same name exists, otherwise append
        current_servers = [s for s in current_servers if s.get("name") != server_name]
        current_servers.append(mcp_entry)
        update_agent(_working_dir, agent["id"], {"mcp_servers": current_servers})

        return _text_response(
            f"Assigned MCP server '{server_name}' to {agent_name}.\n"
            f"  Type: {server_type}\n"
            f"  Command: {command}\n"
            f"  Total MCP servers for {agent_name}: {len(current_servers)}"
        )
    except Exception as e:
        return _error_response(f"Failed to assign MCP server: {str(e)}")


# ─── Self-Improvement Tools (Phase 5C) ─────────────────────────────


@tool(
    "review_agent_performance",
    "Get a performance summary for a specific agent, including task count, "
    "success rate, feedback breakdown, and recent logs. Use this to evaluate "
    "whether an agent's system prompt needs improvement.",
    {
        "agent_name": str,
    },
)
async def review_agent_performance_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Get performance stats for an agent."""
    try:
        agent_name = args.get("agent_name", "").strip()
        if not agent_name:
            return _error_response("agent_name is required.")

        from services.performance_logger import PerformanceLogger

        perf_logger = PerformanceLogger(_working_dir)
        stats = perf_logger.get_agent_stats(agent_name, days=30)

        lines = [
            f"Performance Summary for {agent_name} (last 30 days):",
            f"  Total tasks: {stats.get('total_tasks', 0)}",
            f"  Success rate: {stats.get('success_rate', 0)}%",
            f"  Avg completion: {stats.get('avg_completion_ms', 0)}ms",
            f"  Total cost: ${stats.get('total_cost_usd', 0):.4f}",
        ]

        fb = stats.get("feedback_breakdown", {})
        lines.append(
            f"  Feedback: {fb.get('positive', 0)} positive, "
            f"{fb.get('negative', 0)} negative, "
            f"{fb.get('none', 0)} unrated"
        )

        recent = stats.get("recent_logs", [])
        if recent:
            lines.append("\nRecent activity:")
            for log in recent[-5:]:
                fb_val = log.get("user_feedback", "unrated")
                err = " [ERROR]" if log.get("is_error") else ""
                desc = (log.get("description", "") or "")[:80]
                lines.append(f"  - [{fb_val}]{err} {desc}")

        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to review performance: {str(e)}")


@tool(
    "improve_agent_prompt",
    "Trigger a prompt improvement for a specific agent. Analyses their recent "
    "performance data and rewrites their system prompt to address weaknesses. "
    "Requires self_edit_enabled to be true in the registry.",
    {
        "agent_name": str,
    },
)
async def improve_agent_prompt_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Trigger prompt improvement for an agent."""
    try:
        agent_name = args.get("agent_name", "").strip()
        if not agent_name:
            return _error_response("agent_name is required.")

        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found.")

        from services.performance_logger import PerformanceLogger
        from services.self_improvement import SelfImprovementService
        from services.supabase_client import save_prompt_change

        perf_logger = PerformanceLogger(_working_dir)
        perf_data = perf_logger.get_agent_stats(agent["id"], days=30)

        improvement_service = SelfImprovementService(_working_dir)
        result = await improvement_service.evaluate_and_improve(
            agent_id=agent["id"],
            agent_name=agent["name"],
            prompt_path=agent.get("system_prompt_path", ""),
            performance_data=perf_data,
        )

        if result["improved"] and result["new_prompt"]:
            # Read old prompt
            old_prompt = improvement_service._load_prompt(
                agent.get("system_prompt_path", "")
            )

            # Write new prompt
            improvement_service._save_prompt(
                agent.get("system_prompt_path", ""), result["new_prompt"]
            )

            # Log to Supabase history
            await save_prompt_change(
                agent_id=agent["id"],
                previous_version=old_prompt,
                new_version=result["new_prompt"],
                reason=result["reason"],
                changed_by="clyde",
            )

            return _text_response(
                f"Improved {agent_name}'s system prompt.\n"
                f"Reason: {result['reason']}\n"
                f"The change has been logged to version history."
            )
        else:
            return _text_response(
                f"No improvement made for {agent_name}.\n"
                f"Reason: {result['reason']}"
            )
    except Exception as e:
        return _error_response(f"Failed to improve prompt: {str(e)}")


@tool(
    "update_agent_prompt",
    "Directly update a system prompt for any agent (including yourself, Clyde). "
    "Reads the current prompt, replaces it with the new content, and logs the change "
    "to version history. Use this to add rules, update workflows, or refine behaviour.",
    {
        "agent_name": str,
        "new_prompt": str,
        "reason": str,
    },
)
async def update_agent_prompt_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Directly update an agent's system prompt (including Clyde's own)."""
    try:
        agent_name = args.get("agent_name", "").strip()
        new_prompt = args.get("new_prompt", "").strip()
        reason = args.get("reason", "Manual update").strip()

        if not agent_name:
            return _error_response("agent_name is required.")
        if not new_prompt:
            return _error_response("new_prompt is required.")

        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found.")

        prompt_rel_path = agent.get("system_prompt_path", "")
        if not prompt_rel_path:
            return _error_response(f"No system_prompt_path configured for '{agent_name}'.")

        # Resolve the full path (with safety check)
        try:
            prompt_full_path = _safe_path(prompt_rel_path)
        except ValueError as e:
            return _error_response(str(e))

        # Read old prompt for version history
        old_prompt = ""
        if os.path.exists(prompt_full_path):
            with open(prompt_full_path, "r") as f:
                old_prompt = f.read()

        # Ensure directory exists
        os.makedirs(os.path.dirname(prompt_full_path), exist_ok=True)

        # Write new prompt
        with open(prompt_full_path, "w") as f:
            f.write(new_prompt)

        # Log to Supabase history
        from services.supabase_client import save_prompt_change

        await save_prompt_change(
            agent_id=agent["id"],
            previous_version=old_prompt,
            new_version=new_prompt,
            reason=reason,
            changed_by="clyde",
        )

        return _text_response(
            f"Updated {agent_name}'s system prompt successfully.\n"
            f"Reason: {reason}\n"
            f"The change has been logged to version history."
        )
    except Exception as e:
        return _error_response(f"Failed to update prompt: {str(e)}")


@tool(
    "analyse_team_gaps",
    "Analyse the team for gaps, underutilised agents, and improvement "
    "opportunities. Returns recommendations for archiving idle agents, "
    "improving underperforming agents, and identifying missing capabilities.",
    {},
)
async def analyse_team_gaps_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Analyse team gaps and recommendations."""
    try:
        from services.performance_logger import PerformanceLogger
        from services.self_improvement import SelfImprovementService
        from services.supabase_client import get_recently_active_agents

        perf_logger = PerformanceLogger(_working_dir)
        service = SelfImprovementService(_working_dir)

        # Fetch real usage from Supabase activity_events
        try:
            supabase_active = await get_recently_active_agents(days=30)
        except Exception:
            supabase_active = set()

        analysis = service.analyse_gaps(perf_logger, supabase_active_agents=supabase_active)

        lines = [
            "Team Analysis:",
            f"  Total agents: {analysis.get('total_agents', 0)}",
            f"  Active agents: {analysis.get('active_agents', 0)}",
            f"  Agents used in last 30 days: {analysis.get('agents_used_last_30_days', 0)}",
        ]

        recs = analysis.get("recommendations", [])
        if recs:
            lines.append(f"\nRecommendations ({len(recs)}):")
            for rec in recs:
                rec_type = rec.get("type", "").replace("_", " ").title()
                lines.append(f"  [{rec_type}] {rec.get('reason', '')}")
        else:
            lines.append("\nNo recommendations — team is performing well.")

        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to analyse team: {str(e)}")


@tool(
    "log_performance",
    "Manually log a performance entry after evaluating a subagent's output. "
    "Use this after reviewing task results to record quality observations.",
    {
        "agent_name": str,
        "task_description": str,
        "feedback": str,
    },
)
async def log_performance_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Manually log a performance observation."""
    try:
        agent_name = args.get("agent_name", "").strip()
        task_desc = args.get("task_description", "").strip()
        feedback = args.get("feedback", "").strip().lower()

        if not agent_name:
            return _error_response("agent_name is required.")
        if feedback not in ("positive", "negative"):
            return _error_response("feedback must be 'positive' or 'negative'.")

        agent = get_agent_by_name(_working_dir, agent_name)
        agent_id = agent["id"] if agent else agent_name

        from services.performance_logger import PerformanceLogger

        perf_logger = PerformanceLogger(_working_dir)
        perf_logger.log_event(
            session_id="manual",
            agent_id=agent_id,
            agent_name=agent_name,
            task_type="evaluation",
            description=task_desc,
            user_feedback=feedback,
        )

        return _text_response(
            f"Logged {feedback} performance entry for {agent_name}.\n"
            f"Description: {task_desc}"
        )
    except Exception as e:
        return _error_response(f"Failed to log performance: {str(e)}")


# ─── Proactive Insight Tools (Phase 6) ────────────────────────────


@tool(
    "get_insights",
    "Retrieve recent proactive insights generated by the background analysis engine. "
    "Optionally filter by status (pending, dismissed, snoozed, acted_upon). "
    "Use this when the user asks about recommendations, system health, or optimisations.",
    {"status_filter": str},
)
async def get_insights_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Get proactive insights."""
    try:
        from services.supabase_client import get_pending_insights, get_all_insights

        status_filter = args.get("status_filter", "").strip().lower()

        if status_filter == "pending":
            insights = await get_pending_insights(limit=20)
        else:
            insights = await get_all_insights(limit=30)

        if status_filter and status_filter not in ("pending", "all"):
            insights = [
                i for i in insights if i.get("status") == status_filter
            ]

        if not insights:
            return _text_response(
                "No insights available"
                + (f" with status '{status_filter}'." if status_filter else ".")
                + " The proactive engine may not have run yet."
            )

        lines = [f"Proactive Insights ({len(insights)} total):\n"]
        for i in insights:
            severity = i.get("severity", "info").upper()
            status = i.get("status", "pending")
            created = (i.get("created_at") or "")[:16]
            data = i.get("data", {})
            agent_name = data.get("agent_name", "")
            extra = f" — {agent_name}" if agent_name else ""

            lines.append(
                f"  [{severity}] {i.get('title', 'Untitled')}{extra}\n"
                f"    {i.get('description', '')}\n"
                f"    Status: {status} | Created: {created}\n"
                f"    ID: {i.get('id', '')[:8]}..."
            )

        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to get insights: {str(e)}")


@tool(
    "trigger_analysis",
    "Manually trigger the proactive analysis engine to generate new insights. "
    "This runs all analysis passes (usage patterns, agent health, workflow opportunities) "
    "and returns a summary of new insights generated.",
    {},
)
async def trigger_analysis_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Manually trigger proactive analysis."""
    try:
        from services.proactive_engine import ProactiveEngine

        engine = ProactiveEngine(_working_dir)
        new_insights = await engine.run_analysis()

        if not new_insights:
            return _text_response(
                "Analysis complete — no new insights generated. "
                "The system is either running well or there isn't enough data yet."
            )

        lines = [f"Analysis complete — {len(new_insights)} new insights:\n"]
        for i in new_insights:
            severity = i.get("severity", "info").upper()
            lines.append(
                f"  [{severity}] {i.get('title', 'Untitled')}\n"
                f"    {i.get('description', '')}"
            )

        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to trigger analysis: {str(e)}")


# ─── Create the in-process MCP server (all tools) ─────────────────


registry_mcp_server = create_sdk_mcp_server(
    "registry_tools",
    version="5.0.0",
    tools=[
        # Phase 2: Agent registry
        create_agent_tool,
        list_agents_tool,
        update_agent_tool,
        get_agent_details_tool,
        # Phase 3B: Search
        search_history_tool,
        # Phase 3C: Memory
        read_agent_memory_tool,
        update_agent_memory_tool,
        # Phase 3D: Skills
        create_skill_tool,
        list_skills_tool,
        read_skill_tool,
        update_skill_tool,
        assign_skill_tool,
        # Phase 4C: Schedules
        create_schedule_tool,
        list_schedules_tool,
        delete_schedule_tool,
        pause_schedule_tool,
        # Phase 4D: Triggers
        create_trigger_tool,
        list_triggers_tool,
        delete_trigger_tool,
        # Phase 4E: MCP Server Management
        assign_mcp_server_tool,
        # Phase 5C: Self-Improvement
        review_agent_performance_tool,
        improve_agent_prompt_tool,
        update_agent_prompt_tool,
        analyse_team_gaps_tool,
        log_performance_tool,
        # Phase 6: Proactive Insights
        get_insights_tool,
        trigger_analysis_tool,
    ],
)
