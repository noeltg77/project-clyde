"""
Custom MCP tools for Clyde — Agent Registry Management, Search, Memory, and Skills.

These tools are exposed to Clyde via an in-process MCP server,
allowing Clyde to create, list, update, and inspect subagents,
search chat history, manage agent memory, and handle skills.
"""

import json
import os
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from claude_agent_sdk import tool, create_sdk_mcp_server

from services.registry import (
    load_registry,
    save_registry,
    create_agent,
    update_agent,
    delete_agent,
    get_agent_by_name,
    get_agent_by_id,
    get_active_agents,
    create_team,
    get_teams,
    get_team_by_name,
    get_team_by_id,
    update_team,
    delete_team,
    assign_agent_to_team,
    remove_agent_from_team,
    get_team_members,
    load_teams_index,
    load_team_file,
    TEAM_COLORS,
)
from services.embeddings import generate_query_embedding
from services.settings import load_settings, GEMINI_MODEL_ID_MAP, OPENAI_MODEL_ID_MAP, OPENROUTER_MODEL_ID_MAP
from services.supabase_client import search_messages, save_message, save_activity_event
from services.gemini_client import call_gemini
from services.openai_client import call_openai
from services.openrouter_client import call_openrouter

# Module-level state — set by init_tools() / update_session_context()
_working_dir: str = ""

# Per-session state using ContextVars — each WebSocket handler / scheduled task
# runs in its own asyncio context, so these are automatically scoped per-session.
_session_id_var: ContextVar[str] = ContextVar("session_id", default="")
_ws_var: ContextVar[Any] = ContextVar("ws", default=None)
_pending_visualizations_var: ContextVar[list[dict]] = ContextVar("pending_viz")
_pending_visuals_var: ContextVar[list[dict]] = ContextVar("pending_visuals")


def _get_pending_visualizations() -> list[dict]:
    """Get the per-session pending visualizations list (creates on first access)."""
    try:
        return _pending_visualizations_var.get()
    except LookupError:
        val: list[dict] = []
        _pending_visualizations_var.set(val)
        return val


def _get_pending_visuals() -> list[dict]:
    """Get the per-session pending visuals list (creates on first access)."""
    try:
        return _pending_visuals_var.get()
    except LookupError:
        val: list[dict] = []
        _pending_visuals_var.set(val)
        return val


def get_and_clear_pending_visualizations() -> list[dict]:
    """Return and clear all pending legacy visualisation payloads."""
    pending = _get_pending_visualizations()
    result = list(pending)
    pending.clear()
    return result


def get_and_clear_pending_visuals() -> list[dict]:
    """Return and clear all pending container-based visual payloads."""
    pending = _get_pending_visuals()
    result = list(pending)
    pending.clear()
    return result


def init_tools(working_dir: str) -> None:
    """Set the working directory for all tool functions."""
    global _working_dir
    _working_dir = working_dir


def update_session_context(session_id: str, ws: Any = None) -> None:
    """Update the current chat session ID and WebSocket reference (per-context)."""
    _session_id_var.set(session_id)
    if ws is not None:
        _ws_var.set(ws)
    # Initialize fresh per-session pending lists
    _pending_visualizations_var.set([])
    _pending_visuals_var.set([])


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
    "initialises memory, creates a working directory, automatically assigns a "
    "unique avatar image based on the gender parameter, and registers the agent. "
    "Returns the new agent's details including the assigned avatar path. "
    "IMPORTANT: The 'gender' parameter controls avatar selection — set it to "
    "'male' or 'female' to pick from the corresponding avatar pool. An avatar "
    "is always assigned automatically; you do NOT need a separate avatar parameter. "
    "Set platform to 'gemini' for a tool-free Gemini subagent (use gemini-pro, "
    "gemini-flash, or gemini-lite as the model).",
    {
        "name": str,
        "role": str,
        "model": str,
        "gender": str,
        "system_prompt": str,
        "tools": str,
        "platform": str,
    },
)
async def create_agent_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new subagent."""
    try:
        name = args.get("name", "").strip()
        role = args.get("role", "").strip()
        platform = args.get("platform", "claude").strip().lower()
        settings = load_settings(_working_dir)
        default_model = settings.get("subagent_default_model", "sonnet")
        _platform_default_model = {
            "claude": default_model,
            "gemini": "gemini-flash",
            "openai": "gpt-5.4-mini",
        }
        model = args.get("model", _platform_default_model.get(platform, default_model)).strip().lower()
        gender = args.get("gender", "male").strip().lower()
        system_prompt = args.get("system_prompt", "").strip()
        tools_str = args.get("tools", "")

        if not name:
            return _error_response("Agent name is required.")
        if not role:
            return _error_response("Agent role is required.")
        if not system_prompt:
            return _error_response("System prompt is required.")
        if platform not in ("claude", "gemini", "openai"):
            return _error_response(f"Invalid platform '{platform}'. Must be claude, gemini, or openai.")
        if platform == "claude" and model not in ("sonnet", "haiku", "opus"):
            return _error_response(f"Invalid Claude model '{model}'. Must be sonnet, haiku, or opus.")
        if platform == "gemini" and model not in ("gemini-pro", "gemini-flash", "gemini-lite"):
            return _error_response(f"Invalid Gemini model '{model}'. Must be gemini-pro, gemini-flash, or gemini-lite.")
        if platform == "openai" and model not in ("gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"):
            return _error_response(f"Invalid OpenAI model '{model}'. Must be gpt-5.4, gpt-5.4-mini, or gpt-5.4-nano.")
        if gender not in ("male", "female"):
            return _error_response(f"Invalid gender '{gender}'. Must be male or female.")

        # Gemini and OpenAI agents are tool-free — force empty tools
        if platform in ("gemini", "openai"):
            tools_list = []
        else:
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

        # Store platform in the agent entry
        if platform != "claude":
            agent_entry["platform"] = platform
            update_agent(_working_dir, agent_entry["id"], {"platform": platform})

        return _text_response(
            f"Successfully created agent:\n"
            f"  Name: {agent_entry['name']}\n"
            f"  ID: {agent_entry['id']}\n"
            f"  Role: {agent_entry['role']}\n"
            f"  Platform: {platform}\n"
            f"  Model: {agent_entry['model']}\n"
            f"  Avatar: {agent_entry.get('avatar', 'none')}\n"
            f"  Prompt: {agent_entry['system_prompt_path']}\n"
            f"  Memory: {agent_entry.get('memory_path', '')}\n"
            f"  Working dir: {agent_entry.get('working_dir', '')}\n"
            f"  Tools: {', '.join(agent_entry.get('tools', [])) if platform == 'claude' else '(none — Gemini agents are tool-free)'}"
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
            valid_models = (
                "sonnet", "haiku", "opus",
                "gemini-pro", "gemini-flash", "gemini-lite",
                "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
            )
            if model not in valid_models:
                return _error_response(f"Invalid model '{model}'. Valid: {', '.join(valid_models)}")
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
    "delete_agent",
    "Permanently delete an agent — removes them from the org, deletes their prompt, "
    "memory, and working directory. This cannot be undone.",
    {"agent_name_or_id": str},
)
async def delete_agent_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Permanently delete an agent."""
    try:
        identifier = args.get("agent_name_or_id", "").strip()
        if not identifier:
            return _error_response("agent_name_or_id is required.")

        agent = get_agent_by_name(_working_dir, identifier)
        if not agent:
            agent = get_agent_by_id(_working_dir, identifier)
        if not agent:
            return _error_response(f"Agent '{identifier}' not found.")

        deleted = delete_agent(_working_dir, agent["id"])
        return _text_response(
            f"Permanently deleted agent '{deleted['name']}' ({deleted['id']}). "
            f"Prompt, memory, and working directory removed."
        )

    except ValueError as e:
        return _error_response(str(e))
    except Exception as e:
        return _error_response(f"Failed to delete agent: {str(e)}")


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


# ─── Team Management Tools (Phase 8) ─────────────────────────────


@tool(
    "create_team",
    "Create a new team for grouping agents by function or project. "
    "A unique color is assigned automatically unless specified. "
    "Set icon to a Lucide icon name that represents the team's function. "
    "Common icons: Code, Palette, PenTool, FlaskConical, Megaphone, "
    "BarChart3, Shield, Rocket, Users, Lightbulb, Wrench, Globe, "
    "BookOpen, Camera, Cpu, Database, Layers, Target, Zap, "
    "Briefcase, Building2, GraduationCap, Headphones, Mail, "
    "MessageSquare, Music, Newspaper, Search, ShoppingCart, "
    "Star, TrendingUp, Video, Wand2.",
    {
        "name": str,
        "color": str,
        "icon": str,
    },
)
async def create_team_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new team."""
    try:
        name = args.get("name", "").strip()
        color = args.get("color", "").strip() or None
        icon = args.get("icon", "").strip() or None

        if not name:
            return _error_response("Team name is required.")

        team_entry = create_team(
            working_dir=_working_dir,
            name=name,
            color=color,
            icon=icon,
        )

        return _text_response(
            f"Successfully created team:\n"
            f"  Name: {team_entry['name']}\n"
            f"  ID: {team_entry['id']}\n"
            f"  Color: {team_entry['color']}\n"
            f"  Icon: {team_entry['icon']}"
        )

    except ValueError as e:
        return _error_response(str(e))
    except Exception as e:
        return _error_response(f"Failed to create team: {str(e)}")


@tool(
    "list_teams",
    "List all teams with their members, colors, and IDs.",
    {},
)
async def list_teams_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List all teams."""
    try:
        teams = get_teams(_working_dir)

        if not teams:
            return _text_response("No teams created yet.")

        lines = [f"Teams ({len(teams)} total):\n"]
        for t in teams:
            members = get_team_members(_working_dir, t["id"])
            member_names = [m["name"] for m in members] if members else ["(none)"]
            # Load workflow count from team file
            try:
                team_data = load_team_file(_working_dir, t["id"])
                workflow_count = len(team_data.get("workflows", []))
            except Exception:
                workflow_count = 0
            lines.append(
                f"  - {t['name']} ({t['id']})\n"
                f"    Color: {t['color']}\n"
                f"    Members ({len(members)}): {', '.join(member_names)}\n"
                f"    Workflows: {workflow_count}"
            )

        return _text_response("\n".join(lines))

    except Exception as e:
        return _error_response(f"Failed to list teams: {str(e)}")


@tool(
    "update_team",
    "Update a team's name, color, or icon. Specify the team by name or ID. "
    "Icon should be a Lucide icon name (e.g. Code, Palette, FlaskConical, "
    "Megaphone, Rocket, Shield, Wrench, Target, Zap, Database, Layers).",
    {
        "team_name_or_id": str,
        "name": str,
        "color": str,
        "icon": str,
    },
)
async def update_team_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Update a team's configuration."""
    try:
        identifier = args.get("team_name_or_id", "").strip()
        if not identifier:
            return _error_response("team_name_or_id is required.")

        # Find team by name or ID
        team = get_team_by_name(_working_dir, identifier)
        if not team:
            team = get_team_by_id(_working_dir, identifier)
        if not team:
            return _error_response(f"Team '{identifier}' not found.")

        updates: dict[str, Any] = {}

        new_name = args.get("name", "").strip()
        if new_name:
            updates["name"] = new_name

        new_color = args.get("color", "").strip()
        if new_color:
            updates["color"] = new_color

        new_icon = args.get("icon", "").strip()
        if new_icon:
            updates["icon"] = new_icon

        if not updates:
            return _error_response("No updates provided.")

        updated = update_team(_working_dir, team["id"], updates)
        return _text_response(
            f"Updated team {updated['name']} ({updated['id']}):\n"
            + "\n".join(f"  {k}: {v}" for k, v in updates.items())
        )

    except ValueError as e:
        return _error_response(str(e))
    except Exception as e:
        return _error_response(f"Failed to update team: {str(e)}")


@tool(
    "delete_team",
    "Delete a team and permanently delete all its agents (prompts, memory, working dirs). "
    "Set delete_members to 'false' to keep agents and move them to unassigned instead.",
    {
        "team_name_or_id": str,
        "delete_members": str,
    },
)
async def delete_team_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delete a team."""
    try:
        identifier = args.get("team_name_or_id", "").strip()
        if not identifier:
            return _error_response("team_name_or_id is required.")

        team = get_team_by_name(_working_dir, identifier)
        if not team:
            team = get_team_by_id(_working_dir, identifier)
        if not team:
            return _error_response(f"Team '{identifier}' not found.")

        members = get_team_members(_working_dir, team["id"])
        should_delete = args.get("delete_members", "true").strip().lower() != "false"
        result = delete_team(_working_dir, team["id"], delete_members=should_delete)

        if should_delete:
            deleted = result.get("deleted_members", [])
            return _text_response(
                f"Deleted team '{team['name']}' and permanently removed "
                f"{len(deleted)} agent(s): {', '.join(deleted) if deleted else 'none'}."
            )
        else:
            unassigned = result.get("unassigned_members", [])
            return _text_response(
                f"Deleted team '{team['name']}'. "
                f"{len(unassigned)} agent(s) moved to unassigned."
            )

    except ValueError as e:
        return _error_response(str(e))
    except Exception as e:
        return _error_response(f"Failed to delete team: {str(e)}")


@tool(
    "assign_agent_to_team",
    "Add an agent to a team. An agent can only belong to one team at a time. "
    "If the agent is already in another team, they will be moved.",
    {
        "agent_name_or_id": str,
        "team_name_or_id": str,
    },
)
async def assign_agent_to_team_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Assign an agent to a team."""
    try:
        agent_identifier = args.get("agent_name_or_id", "").strip()
        team_identifier = args.get("team_name_or_id", "").strip()

        if not agent_identifier:
            return _error_response("agent_name_or_id is required.")
        if not team_identifier:
            return _error_response("team_name_or_id is required.")

        # Find agent
        agent = get_agent_by_name(_working_dir, agent_identifier)
        if not agent:
            agent = get_agent_by_id(_working_dir, agent_identifier)
        if not agent:
            return _error_response(f"Agent '{agent_identifier}' not found.")

        # Find team
        team = get_team_by_name(_working_dir, team_identifier)
        if not team:
            team = get_team_by_id(_working_dir, team_identifier)
        if not team:
            return _error_response(f"Team '{team_identifier}' not found.")

        updated = assign_agent_to_team(_working_dir, agent["id"], team["id"])
        return _text_response(
            f"Assigned {updated['name']} to team '{team['name']}'."
        )

    except ValueError as e:
        return _error_response(str(e))
    except Exception as e:
        return _error_response(f"Failed to assign agent to team: {str(e)}")


@tool(
    "remove_agent_from_team",
    "Remove an agent from their current team.",
    {
        "agent_name_or_id": str,
    },
)
async def remove_agent_from_team_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Remove an agent from their team."""
    try:
        identifier = args.get("agent_name_or_id", "").strip()
        if not identifier:
            return _error_response("agent_name_or_id is required.")

        agent = get_agent_by_name(_working_dir, identifier)
        if not agent:
            agent = get_agent_by_id(_working_dir, identifier)
        if not agent:
            return _error_response(f"Agent '{identifier}' not found.")

        if not agent.get("team"):
            return _text_response(f"{agent['name']} is not in any team.")

        updated = remove_agent_from_team(_working_dir, agent["id"])
        return _text_response(
            f"Removed {updated['name']} from their team."
        )

    except ValueError as e:
        return _error_response(str(e))
    except Exception as e:
        return _error_response(f"Failed to remove agent from team: {str(e)}")


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
        schedule = await scheduler.add_schedule(
            name,
            prompt,
            agent_name,
            schedule_type="recurring",
            cron=cron,
        )

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
    "Assign an MCP server to an agent. If the MCP server doesn't exist as an "
    "integration yet, it will be created. The agent will be added to the "
    "integration's assigned_agents list.",
    {"agent_name": str, "server_name": str, "server_type": str, "command": str},
)
async def assign_mcp_server_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Assign an MCP server integration to an agent."""
    try:
        from services.supabase_client import (
            get_integrations, create_integration, update_integration,
        )

        agent_name = args.get("agent_name", "").strip()
        server_name = args.get("server_name", "").strip()
        server_type = args.get("server_type", "stdio").strip()
        command = args.get("command", "").strip()

        if not agent_name:
            return _error_response("agent_name is required.")
        if not server_name:
            return _error_response("server_name is required.")

        # Find agent
        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found.")

        # Check if MCP integration with this name already exists
        existing = await get_integrations(type_filter="mcp")
        mcp_int = next((i for i in existing if i["name"] == server_name), None)

        if not mcp_int:
            if not command:
                return _error_response(
                    "command is required when creating a new MCP server "
                    "(the command to start the MCP server)."
                )
            # Create new MCP integration
            mcp_int = await create_integration(
                name=server_name,
                int_type="mcp",
                method="MCP",
                description=f"MCP server: {server_name}",
                metadata={
                    "server_type": server_type,
                    "command": command,
                    "args": [],
                    "env": {},
                    "url": "",
                },
            )

        # Add agent to assigned_agents
        current_agents: list[str] = mcp_int.get("assigned_agents", [])
        if agent["id"] not in current_agents:
            current_agents.append(agent["id"])
            await update_integration(mcp_int["id"], assigned_agents=current_agents)

        return _text_response(
            f"Assigned MCP server '{server_name}' to {agent_name}.\n"
            f"  Integration ID: {mcp_int.get('id', 'N/A')}\n"
            f"  Server type: {server_type}\n"
            f"  Command: {command or mcp_int.get('metadata', {}).get('command', '(existing)')}\n"
            f"  Total assigned agents: {len(current_agents)}"
        )
    except Exception as e:
        return _error_response(f"Failed to assign MCP server: {str(e)}")


@tool(
    "create_mcp_server",
    "Create a new MCP (Model Context Protocol) server integration. "
    "Shortcut for create_integration with type='mcp'. "
    "server_type is 'stdio' (default) or 'sse'. "
    "For stdio: provide 'command' and optional 'args' (JSON array). "
    "For sse: provide 'url'. "
    "Optional 'env' is a JSON object of environment variables for the server.",
    {
        "name": str, "server_type": str, "command": str, "args": str,
        "url": str, "env": str, "description": str,
    },
)
async def create_mcp_server_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new MCP server integration."""
    try:
        from services.supabase_client import create_integration

        name = args.get("name", "").strip()
        if not name:
            return _error_response("MCP server name is required.")

        server_type = args.get("server_type", "stdio").strip()
        command = args.get("command", "").strip()
        url = args.get("url", "").strip()
        description = args.get("description", "").strip()

        # Parse args
        args_str = args.get("args", "").strip()
        mcp_args: list[str] = []
        if args_str:
            try:
                mcp_args = json.loads(args_str)
            except json.JSONDecodeError:
                mcp_args = [a.strip() for a in args_str.split(",") if a.strip()]

        # Parse env
        env_str = args.get("env", "").strip()
        mcp_env: dict[str, str] = {}
        if env_str:
            try:
                mcp_env = json.loads(env_str)
            except json.JSONDecodeError:
                pass

        integration = await create_integration(
            name=name,
            int_type="mcp",
            base_url=url if server_type == "sse" else "",
            method="MCP",
            description=description or f"MCP server: {name}",
            metadata={
                "server_type": server_type,
                "command": command,
                "args": mcp_args,
                "url": url,
                "env": mcp_env,
            },
        )

        return _text_response(
            f"Created MCP server '{name}':\n"
            f"  ID: {integration.get('id', 'N/A')}\n"
            f"  Server type: {server_type}\n"
            f"  Command: {command or '(none)'}\n"
            f"  Args: {mcp_args}\n"
            f"  URL: {url or '(none)'}\n"
            f"  Description: {description[:100]}"
        )
    except Exception as e:
        return _error_response(f"Failed to create MCP server: {str(e)}")


@tool(
    "list_mcp_servers",
    "List all registered MCP server integrations with their configuration, "
    "status, and assigned agents.",
    {},
)
async def list_mcp_servers_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List all MCP server integrations."""
    try:
        from services.supabase_client import get_integrations

        servers = await get_integrations(type_filter="mcp")
        if not servers:
            return _text_response("No MCP servers configured yet.")

        lines = [f"MCP Servers ({len(servers)} total):\n"]
        for s in servers:
            status = "enabled" if s.get("enabled") else "disabled"
            agents = s.get("assigned_agents") or []
            meta = s.get("metadata") or {}
            lines.append(
                f"  - {s['name']} ({s['id']})\n"
                f"    Server type: {meta.get('server_type', 'stdio')}\n"
                f"    Command: {meta.get('command', '(none)')}\n"
                f"    Args: {meta.get('args', [])}\n"
                f"    URL: {meta.get('url', '(none)')}\n"
                f"    Env vars: {list(meta.get('env', {}).keys()) or '(none)'}\n"
                f"    Status: {status}\n"
                f"    Assigned agents: {', '.join(agents) if agents else '(none)'}\n"
                f"    Description: {s.get('description', '')[:80]}"
            )

        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to list MCP servers: {str(e)}")


@tool(
    "update_mcp_server",
    "Update an existing MCP server integration. Pass the integration_id and a "
    "JSON string of fields to update. MCP-specific fields (command, args, url, "
    "env, server_type) should be nested under a 'metadata' key.",
    {"integration_id": str, "updates": str},
)
async def update_mcp_server_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Update an MCP server integration."""
    try:
        from services.supabase_client import get_integration, update_integration

        integration_id = args.get("integration_id", "").strip()
        updates_str = args.get("updates", "").strip()
        if not integration_id:
            return _error_response("integration_id is required.")
        if not updates_str:
            return _error_response("updates JSON string is required.")

        try:
            updates = json.loads(updates_str)
        except json.JSONDecodeError:
            return _error_response("updates must be a valid JSON string.")

        # Verify it's an MCP integration
        existing = await get_integration(integration_id)
        if not existing:
            return _error_response(f"Integration not found: {integration_id}")
        if existing.get("type") != "mcp":
            return _error_response("This tool only updates MCP server integrations.")

        # Merge metadata updates if provided
        if "metadata" in updates:
            current_meta = existing.get("metadata") or {}
            current_meta.update(updates["metadata"])
            updates["metadata"] = current_meta

        updated = await update_integration(integration_id, **updates)
        if not updated:
            return _error_response(f"Failed to update MCP server: {integration_id}")

        return _text_response(f"Updated MCP server {integration_id}: {json.dumps(updates)}")
    except Exception as e:
        return _error_response(f"Failed to update MCP server: {str(e)}")


@tool(
    "delete_mcp_server",
    "Remove an MCP server integration by its ID.",
    {"integration_id": str},
)
async def delete_mcp_server_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delete an MCP server integration."""
    try:
        from services.supabase_client import get_integration, delete_integration

        integration_id = args.get("integration_id", "").strip()
        if not integration_id:
            return _error_response("integration_id is required.")

        # Verify it's an MCP integration
        existing = await get_integration(integration_id)
        if not existing:
            return _error_response(f"Integration not found: {integration_id}")
        if existing.get("type") != "mcp":
            return _error_response("This tool only deletes MCP server integrations.")

        deleted = await delete_integration(integration_id)
        if not deleted:
            return _error_response(f"MCP server not found: {integration_id}")
        return _text_response(f"Deleted MCP server: {existing.get('name', integration_id)}")
    except Exception as e:
        return _error_response(f"Failed to delete MCP server: {str(e)}")


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


# ─── Task Board Tools (Phase 7) ───────────────────────────────────


@tool(
    "list_task_columns",
    "List all kanban columns on the task board, ordered by position. "
    "Returns column IDs, names, and positions.",
    {},
)
async def list_task_columns_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List all task board columns."""
    try:
        from services.supabase_client import get_task_columns

        columns = await get_task_columns()
        if not columns:
            return _text_response("No columns on the task board yet.")
        lines = [f"Task board columns ({len(columns)}):\n"]
        for col in columns:
            lines.append(f"  • {col['name']} (id: {col['id']}, position: {col['position']})")
        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to list task columns: {str(e)}")


@tool(
    "create_task_column",
    "Create a new column on the task board. Columns represent workflow stages "
    "(e.g. 'To Do', 'In Progress', 'Done').",
    {
        "name": {
            "type": str,
            "description": "The column name (e.g. 'To Do', 'In Progress', 'Review', 'Done').",
            "required": True,
        },
        "position": {
            "type": int,
            "description": "Position index for ordering (0-based). Defaults to appending at end.",
            "required": False,
        },
    },
)
async def create_task_column_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new task board column."""
    try:
        from services.supabase_client import get_task_columns, create_task_column

        name = args.get("name", "New Column").strip()
        if not name:
            return _error_response("Column name is required.")

        # Default position: append to end
        if "position" in args:
            position = int(args["position"])
        else:
            existing = await get_task_columns()
            position = len(existing)

        col = await create_task_column(name, position)
        return _text_response(
            f"Created column '{col.get('name', name)}' (id: {col.get('id', 'unknown')}, position: {position})."
        )
    except Exception as e:
        return _error_response(f"Failed to create task column: {str(e)}")


@tool(
    "delete_task_column",
    "Delete a column from the task board. This also deletes all tasks in the column.",
    {
        "column_id": {
            "type": str,
            "description": "The ID of the column to delete. Use list_task_columns to find IDs.",
            "required": True,
        },
    },
)
async def delete_task_column_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delete a task board column."""
    try:
        from services.supabase_client import delete_task_column

        column_id = args.get("column_id", "").strip()
        if not column_id:
            return _error_response("column_id is required.")

        deleted = await delete_task_column(column_id)
        if not deleted:
            return _error_response(f"Column not found: {column_id}")
        return _text_response(f"Deleted column {column_id} and all its tasks.")
    except Exception as e:
        return _error_response(f"Failed to delete task column: {str(e)}")


@tool(
    "list_tasks",
    "List all tasks on the task board. Optionally filter by column ID. "
    "Returns task titles, descriptions, assignees, and column placement.",
    {
        "column_id": {
            "type": str,
            "description": "Optional column ID to filter tasks by. Omit for all tasks.",
            "required": False,
        },
    },
)
async def list_tasks_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List tasks, optionally filtered by column."""
    try:
        from services.supabase_client import get_tasks, get_task_columns

        tasks = await get_tasks()
        columns = await get_task_columns()
        col_map = {c["id"]: c["name"] for c in columns}

        column_filter = args.get("column_id", "").strip()
        if column_filter:
            tasks = [t for t in tasks if t.get("column_id") == column_filter]

        if not tasks:
            return _text_response("No tasks found.")

        lines = [f"Tasks ({len(tasks)}):\n"]
        for t in tasks:
            col_name = col_map.get(t.get("column_id", ""), "Unknown")
            assignee = t.get("assignee_name") or "Unassigned"
            lines.append(
                f"  • [{col_name}] {t['title']} (id: {t['id']})\n"
                f"    Assignee: {assignee}"
            )
            if t.get("description"):
                desc = t["description"][:100] + ("..." if len(t["description"]) > 100 else "")
                lines.append(f"    Description: {desc}")
        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to list tasks: {str(e)}")


@tool(
    "create_task",
    "Create a new task on the task board. Tasks represent actionable work items. "
    "Assign to agents, link documents, and place in the appropriate column.",
    {
        "title": {
            "type": str,
            "description": "The task title — clear and actionable.",
            "required": True,
        },
        "column_id": {
            "type": str,
            "description": "Which column to place the task in. Use list_task_columns to find IDs.",
            "required": True,
        },
        "description": {
            "type": str,
            "description": "Detailed description of the task.",
            "required": False,
        },
        "assignee_type": {
            "type": str,
            "description": "Type of assignee: 'agent', 'user', or 'clyde'.",
            "required": False,
        },
        "assignee_id": {
            "type": str,
            "description": "The ID of the assigned agent (from the registry), 'user', or Clyde's ID.",
            "required": False,
        },
        "assignee_name": {
            "type": str,
            "description": "Display name of the assignee.",
            "required": False,
        },
        "linked_docs": {
            "type": str,
            "description": "JSON array of linked documents, each with 'path' and 'name' fields. E.g. '[{\"path\": \"/working/outputs/report.md\", \"name\": \"report.md\"}]'",
            "required": False,
        },
    },
)
async def create_task_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new task on the board."""
    try:
        from services.supabase_client import create_task

        title = args.get("title", "").strip()
        if not title:
            return _error_response("Task title is required.")

        column_id = args.get("column_id", "").strip()
        if not column_id:
            return _error_response("column_id is required.")

        # Parse linked_docs from JSON string if provided
        linked_docs = None
        if args.get("linked_docs"):
            try:
                linked_docs = json.loads(args["linked_docs"])
            except json.JSONDecodeError:
                return _error_response("linked_docs must be a valid JSON array.")

        task = await create_task(
            title=title,
            column_id=column_id,
            description=args.get("description", ""),
            assignee_type=args.get("assignee_type"),
            assignee_id=args.get("assignee_id"),
            assignee_name=args.get("assignee_name"),
            linked_docs=linked_docs,
        )
        return _text_response(
            f"Created task '{task.get('title', title)}' (id: {task.get('id', 'unknown')}) "
            f"in column {column_id}."
        )
    except Exception as e:
        return _error_response(f"Failed to create task: {str(e)}")


@tool(
    "update_task",
    "Update an existing task — change its title, description, column, assignee, "
    "or linked documents. Also use this to move a task between columns.",
    {
        "task_id": {
            "type": str,
            "description": "The ID of the task to update.",
            "required": True,
        },
        "title": {
            "type": str,
            "description": "New title for the task.",
            "required": False,
        },
        "description": {
            "type": str,
            "description": "New description for the task.",
            "required": False,
        },
        "column_id": {
            "type": str,
            "description": "Move the task to a different column by specifying the target column ID.",
            "required": False,
        },
        "assignee_type": {
            "type": str,
            "description": "Type of assignee: 'agent', 'user', or 'clyde'.",
            "required": False,
        },
        "assignee_id": {
            "type": str,
            "description": "The ID of the assigned agent.",
            "required": False,
        },
        "assignee_name": {
            "type": str,
            "description": "Display name of the assignee.",
            "required": False,
        },
    },
)
async def update_task_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Update an existing task."""
    try:
        from services.supabase_client import update_task

        task_id = args.get("task_id", "").strip()
        if not task_id:
            return _error_response("task_id is required.")

        fields = {}
        for key in ["title", "description", "column_id", "assignee_type", "assignee_id", "assignee_name"]:
            if key in args and args[key] is not None:
                fields[key] = args[key]

        if not fields:
            return _error_response("No fields to update. Provide at least one field to change.")

        task = await update_task(task_id, **fields)
        if not task:
            return _error_response(f"Task not found: {task_id}")
        return _text_response(
            f"Updated task '{task.get('title', task_id)}' — changed: {', '.join(fields.keys())}."
        )
    except Exception as e:
        return _error_response(f"Failed to update task: {str(e)}")


@tool(
    "delete_task",
    "Delete a task from the task board.",
    {
        "task_id": {
            "type": str,
            "description": "The ID of the task to delete. Use list_tasks to find IDs.",
            "required": True,
        },
    },
)
async def delete_task_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delete a task."""
    try:
        from services.supabase_client import delete_task

        task_id = args.get("task_id", "").strip()
        if not task_id:
            return _error_response("task_id is required.")

        deleted = await delete_task(task_id)
        if not deleted:
            return _error_response(f"Task not found: {task_id}")
        return _text_response(f"Deleted task {task_id}.")
    except Exception as e:
        return _error_response(f"Failed to delete task: {str(e)}")


# ─── Integration Tools (Phase 9: APIs & Webhooks) ────────────────


@tool(
    "create_integration",
    "Register a new API, webhook, or MCP server integration. Stores the "
    "configuration in the database and optionally saves credentials to .env.local. "
    "Set type to 'api' for REST APIs, 'webhook' for webhooks, or 'mcp' for MCP servers. "
    "For MCP servers: set 'server_type' ('stdio' or 'sse'), 'command' (for stdio), "
    "'mcp_args' (JSON array of command arguments), 'mcp_url' (for sse), and "
    "'mcp_env' (JSON object of environment variables). "
    "auth_type can be 'bearer', 'api_key', 'basic', or 'none'. "
    "credential_env_key is the env var name (e.g. 'STRIPE_API_KEY') and "
    "credential_value is the actual secret to store.",
    {
        "name": str, "type": str, "base_url": str, "method": str,
        "auth_type": str, "credential_env_key": str, "credential_value": str,
        "description": str, "documentation_url": str,
        "server_type": str, "command": str, "mcp_args": str, "mcp_url": str,
        "mcp_env": str,
    },
)
async def create_integration_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new integration (API, webhook, or MCP server)."""
    try:
        from services.supabase_client import create_integration

        name = args.get("name", "").strip()
        int_type = args.get("type", "").strip()
        if not name:
            return _error_response("Integration name is required.")
        if int_type not in ("api", "webhook", "mcp"):
            return _error_response("type must be 'api', 'webhook', or 'mcp'.")

        base_url = args.get("base_url", "").strip()
        method = args.get("method", "GET").strip().upper()
        auth_type = args.get("auth_type", "none").strip()
        credential_env_key = args.get("credential_env_key", "").strip() or None
        credential_value = args.get("credential_value", "").strip() or None
        description = args.get("description", "").strip()
        documentation_url = args.get("documentation_url", "").strip() or None

        # Write credential to .env.local if provided
        if credential_env_key and credential_value:
            env_path = os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env.local"
            )
            lines: list[str] = []
            found = False
            if os.path.exists(env_path):
                with open(env_path, "r") as f:
                    for line in f:
                        if line.strip().startswith(f"{credential_env_key}="):
                            lines.append(f"{credential_env_key}={credential_value}\n")
                            found = True
                        else:
                            lines.append(line)
            if not found:
                if lines and not lines[-1].endswith("\n"):
                    lines.append("\n")
                lines.append(f"\n# Integration: {credential_env_key}\n")
                lines.append(f"{credential_env_key}={credential_value}\n")
            with open(env_path, "w") as f:
                f.writelines(lines)
            os.environ[credential_env_key] = credential_value

        # Build MCP metadata if type is 'mcp'
        metadata: dict[str, Any] = {}
        if int_type == "mcp":
            mcp_server_type = args.get("server_type", "stdio").strip()
            mcp_command = args.get("command", "").strip()
            mcp_url = args.get("mcp_url", "").strip()
            mcp_args_str = args.get("mcp_args", "").strip()
            mcp_env_str = args.get("mcp_env", "").strip()

            mcp_args_list: list[str] = []
            if mcp_args_str:
                try:
                    mcp_args_list = json.loads(mcp_args_str)
                except json.JSONDecodeError:
                    mcp_args_list = [a.strip() for a in mcp_args_str.split(",") if a.strip()]

            mcp_env_dict: dict[str, str] = {}
            if mcp_env_str:
                try:
                    mcp_env_dict = json.loads(mcp_env_str)
                except json.JSONDecodeError:
                    pass

            metadata = {
                "server_type": mcp_server_type,
                "command": mcp_command,
                "args": mcp_args_list,
                "url": mcp_url,
                "env": mcp_env_dict,
            }
            # For SSE servers, store the URL as base_url too
            if mcp_server_type == "sse" and mcp_url:
                base_url = mcp_url
            method = "MCP"

        integration = await create_integration(
            name=name,
            int_type=int_type,
            base_url=base_url,
            method=method,
            auth_type=auth_type,
            credential_env_key=credential_env_key,
            description=description,
            documentation_url=documentation_url,
            metadata=metadata if metadata else None,
        )

        if int_type == "mcp":
            return _text_response(
                f"Created MCP server integration '{name}':\n"
                f"  ID: {integration.get('id', 'N/A')}\n"
                f"  Server type: {metadata.get('server_type', 'stdio')}\n"
                f"  Command: {metadata.get('command', '(none)')}\n"
                f"  Args: {metadata.get('args', [])}\n"
                f"  URL: {metadata.get('url', '(none)')}\n"
                f"  Description: {description[:100]}"
            )

        return _text_response(
            f"Created {int_type} integration '{name}':\n"
            f"  ID: {integration.get('id', 'N/A')}\n"
            f"  URL: {base_url}\n"
            f"  Auth: {auth_type}\n"
            f"  Credential key: {credential_env_key or '(none)'}\n"
            f"  Description: {description[:100]}"
        )
    except Exception as e:
        return _error_response(f"Failed to create integration: {str(e)}")


@tool(
    "list_integrations",
    "List all registered API, webhook, and MCP server integrations with their "
    "configuration, status, and assigned agents. Optionally filter by type "
    "('api', 'webhook', or 'mcp').",
    {"type_filter": str},
)
async def list_integrations_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List all integrations."""
    try:
        from services.supabase_client import get_integrations

        type_filter = args.get("type_filter", "").strip() or None
        integrations = await get_integrations(type_filter=type_filter)

        if not integrations:
            return _text_response("No integrations configured yet.")

        lines = [f"Integrations ({len(integrations)} total):\n"]
        for i in integrations:
            status = "enabled" if i.get("enabled") else "disabled"
            agents = i.get("assigned_agents") or []
            meta = i.get("metadata") or {}

            if i["type"] == "mcp":
                lines.append(
                    f"  - {i['name']} ({i['id']})\n"
                    f"    Type: mcp\n"
                    f"    Server type: {meta.get('server_type', 'stdio')}\n"
                    f"    Command: {meta.get('command', '(none)')}\n"
                    f"    Args: {meta.get('args', [])}\n"
                    f"    URL: {meta.get('url', '(none)')}\n"
                    f"    Status: {status}\n"
                    f"    Assigned agents: {', '.join(agents) if agents else '(none)'}\n"
                    f"    Description: {i.get('description', '')[:80]}"
                )
            else:
                lines.append(
                    f"  - {i['name']} ({i['id']})\n"
                    f"    Type: {i['type']}\n"
                    f"    URL: {i.get('base_url', '')}\n"
                    f"    Method: {i.get('method', 'GET')}\n"
                    f"    Auth: {i.get('auth_type', 'none')}\n"
                    f"    Status: {status}\n"
                    f"    Assigned agents: {', '.join(agents) if agents else '(none)'}\n"
                    f"    Description: {i.get('description', '')[:80]}"
                )

        return _text_response("\n".join(lines))
    except Exception as e:
        return _error_response(f"Failed to list integrations: {str(e)}")


@tool(
    "get_integration",
    "Get detailed information about a specific integration by ID, including "
    "its URL, auth type, headers, and which agents it is assigned to.",
    {"integration_id": str},
)
async def get_integration_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Get a single integration's details."""
    try:
        from services.supabase_client import get_integration

        integration_id = args.get("integration_id", "").strip()
        if not integration_id:
            return _error_response("integration_id is required.")

        integration = await get_integration(integration_id)
        if not integration:
            return _error_response(f"Integration not found: {integration_id}")

        agents = integration.get("assigned_agents") or []
        headers = integration.get("headers") or {}
        return _text_response(
            f"Integration: {integration['name']}\n"
            f"  ID: {integration['id']}\n"
            f"  Type: {integration['type']}\n"
            f"  URL: {integration.get('base_url', '')}\n"
            f"  Method: {integration.get('method', 'GET')}\n"
            f"  Auth: {integration.get('auth_type', 'none')}\n"
            f"  Credential env key: {integration.get('credential_env_key') or '(none)'}\n"
            f"  Headers: {json.dumps(headers)}\n"
            f"  Enabled: {integration.get('enabled', True)}\n"
            f"  Assigned agents: {', '.join(agents) if agents else '(none)'}\n"
            f"  Docs: {integration.get('documentation_url') or '(none)'}\n"
            f"  Description: {integration.get('description', '')}"
        )
    except Exception as e:
        return _error_response(f"Failed to get integration: {str(e)}")


@tool(
    "update_integration",
    "Update an existing integration's configuration (URL, headers, auth, etc.). "
    "Pass a JSON string of fields to update.",
    {"integration_id": str, "updates": str},
)
async def update_integration_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Update an integration."""
    try:
        from services.supabase_client import update_integration

        integration_id = args.get("integration_id", "").strip()
        updates_str = args.get("updates", "").strip()
        if not integration_id:
            return _error_response("integration_id is required.")
        if not updates_str:
            return _error_response("updates JSON string is required.")

        try:
            updates = json.loads(updates_str)
        except json.JSONDecodeError:
            return _error_response("updates must be a valid JSON string.")

        # Handle credential update separately
        credential_env_key = updates.pop("credential_env_key", None)
        credential_value = updates.pop("credential_value", None)
        if credential_env_key and credential_value:
            env_path = os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env.local"
            )
            lines: list[str] = []
            found = False
            if os.path.exists(env_path):
                with open(env_path, "r") as f:
                    for line in f:
                        if line.strip().startswith(f"{credential_env_key}="):
                            lines.append(f"{credential_env_key}={credential_value}\n")
                            found = True
                        else:
                            lines.append(line)
            if not found:
                if lines and not lines[-1].endswith("\n"):
                    lines.append("\n")
                lines.append(f"\n# Integration: {credential_env_key}\n")
                lines.append(f"{credential_env_key}={credential_value}\n")
            with open(env_path, "w") as f:
                f.writelines(lines)
            os.environ[credential_env_key] = credential_value
            updates["credential_env_key"] = credential_env_key

        updated = await update_integration(integration_id, **updates)
        if not updated:
            return _error_response(f"Integration not found: {integration_id}")

        return _text_response(f"Updated integration {integration_id}: {json.dumps(updates)}")
    except Exception as e:
        return _error_response(f"Failed to update integration: {str(e)}")


@tool(
    "delete_integration",
    "Remove an API, webhook, or MCP server integration by its ID.",
    {"integration_id": str},
)
async def delete_integration_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delete an integration."""
    try:
        from services.supabase_client import delete_integration

        integration_id = args.get("integration_id", "").strip()
        if not integration_id:
            return _error_response("integration_id is required.")

        deleted = await delete_integration(integration_id)
        if not deleted:
            return _error_response(f"Integration not found: {integration_id}")
        return _text_response(f"Deleted integration: {integration_id}")
    except Exception as e:
        return _error_response(f"Failed to delete integration: {str(e)}")


@tool(
    "assign_integration",
    "Assign an API, webhook, or MCP server integration to one or more subagents "
    "so they can use it during tasks. Pass agent IDs as a comma-separated string.",
    {"integration_id": str, "agent_ids": str},
)
async def assign_integration_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Assign agents to an integration."""
    try:
        from services.supabase_client import update_integration

        integration_id = args.get("integration_id", "").strip()
        agent_ids_str = args.get("agent_ids", "").strip()
        if not integration_id:
            return _error_response("integration_id is required.")

        # Parse agent IDs (comma-separated or JSON array)
        agent_ids: list[str] = []
        if agent_ids_str:
            try:
                agent_ids = json.loads(agent_ids_str)
            except json.JSONDecodeError:
                agent_ids = [a.strip() for a in agent_ids_str.split(",") if a.strip()]

        updated = await update_integration(integration_id, assigned_agents=agent_ids)
        if not updated:
            return _error_response(f"Integration not found: {integration_id}")

        return _text_response(
            f"Assigned {len(agent_ids)} agent(s) to integration {integration_id}: "
            f"{', '.join(agent_ids)}"
        )
    except Exception as e:
        return _error_response(f"Failed to assign integration: {str(e)}")


@tool(
    "call_integration",
    "Make an HTTP request using a registered integration's stored configuration. "
    "Reads the credential from the environment, applies headers and auth, and "
    "executes the request. Returns the response status and body. "
    "Use 'path' to append to the base URL (e.g. '/customers'). "
    "Use 'body' for JSON request body and 'query_params' for URL parameters.",
    {
        "integration_id": str, "path": str, "method": str,
        "body": str, "query_params": str,
    },
)
async def call_integration_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Make an HTTP request using a registered integration."""
    try:
        import httpx
        from services.supabase_client import get_integration

        integration_id = args.get("integration_id", "").strip()
        if not integration_id:
            return _error_response("integration_id is required.")

        integration = await get_integration(integration_id)
        if not integration:
            return _error_response(f"Integration not found: {integration_id}")

        if not integration.get("enabled", True):
            return _error_response(f"Integration '{integration['name']}' is disabled.")

        # Build URL
        base_url = integration.get("base_url", "").rstrip("/")
        path = args.get("path", "").strip()
        url = f"{base_url}/{path.lstrip('/')}" if path else base_url

        # Determine method
        method = (args.get("method", "").strip().upper()
                  or integration.get("method", "GET"))

        # Build headers from integration config
        headers: dict[str, str] = dict(integration.get("headers") or {})

        # Apply authentication
        auth_type = integration.get("auth_type", "none")
        credential_env_key = integration.get("credential_env_key")
        if credential_env_key and auth_type != "none":
            credential = os.environ.get(credential_env_key, "")
            if not credential:
                return _error_response(
                    f"Credential not found in environment: {credential_env_key}. "
                    f"Please set the credential value first."
                )
            if auth_type == "bearer":
                headers["Authorization"] = f"Bearer {credential}"
            elif auth_type == "api_key":
                headers["X-API-Key"] = credential
            elif auth_type == "basic":
                import base64
                encoded = base64.b64encode(credential.encode()).decode()
                headers["Authorization"] = f"Basic {encoded}"

        # Parse body and query params
        request_body = None
        body_str = args.get("body", "").strip()
        if body_str:
            try:
                request_body = json.loads(body_str)
                if "Content-Type" not in headers:
                    headers["Content-Type"] = "application/json"
            except json.JSONDecodeError:
                return _error_response("body must be a valid JSON string.")

        params = None
        params_str = args.get("query_params", "").strip()
        if params_str:
            try:
                params = json.loads(params_str)
            except json.JSONDecodeError:
                return _error_response("query_params must be a valid JSON string.")

        # Execute request
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=method,
                url=url,
                headers=headers,
                json=request_body if request_body else None,
                params=params,
            )

        # Truncate response body to avoid context bloat
        response_text = response.text[:4000]
        if len(response.text) > 4000:
            response_text += f"\n... (truncated, full response is {len(response.text)} chars)"

        return _text_response(
            f"HTTP {response.status_code} {method} {url}\n\n{response_text}"
        )
    except Exception as e:
        return _error_response(f"Failed to call integration: {str(e)}")


# ─── Workflow Tools (Phase 10) ─────────────────────────────────────


def _find_workflow(name_or_id: str) -> str | None:
    """Find a workflow file by ID, name, or sanitised name. Returns abs path or None."""
    workflows_dir = os.path.join(_working_dir, "workflows")
    if not os.path.isdir(workflows_dir):
        return None

    # Try exact ID match
    try:
        exact = _safe_path(f"workflows/{name_or_id}.json")
        if os.path.exists(exact):
            return exact
    except ValueError:
        pass

    # Scan all workflow files for a name match
    for fname in os.listdir(workflows_dir):
        if not fname.endswith(".json"):
            continue
        fpath = os.path.join(workflows_dir, fname)
        try:
            with open(fpath, "r") as f:
                data = json.load(f)
            if data.get("name", "").lower() == name_or_id.lower():
                return fpath
            if data.get("id", "").lower() == name_or_id.lower():
                return fpath
        except (json.JSONDecodeError, OSError):
            continue

    # Try sanitised kebab-case
    sanitised = name_or_id.lower().replace(" ", "-").replace("_", "-")
    try:
        san_path = _safe_path(f"workflows/{sanitised}.json")
        if os.path.exists(san_path):
            return san_path
    except ValueError:
        pass

    return None


@tool(
    "create_workflow",
    "Create a new workflow — a multi-stage process that defines how agents collaborate "
    "on a specific type of task. Workflows belong to teams and describe stage sequences, "
    "agent assignments, rules, and failure handling. "
    "stages must be a JSON array of stage objects with: stage (number), name, agent, action, "
    "inputs (array), outputs (array), blocking (bool). "
    "rules is an optional JSON array of constraint strings.",
    {
        "name": str,
        "description": str,
        "team_name_or_id": str,
        "stages": str,
        "rules": str,
        "on_failure": str,
    },
)
async def create_workflow_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new workflow and assign it to a team."""
    try:
        name = args.get("name", "").strip()
        description = args.get("description", "").strip()
        team_identifier = args.get("team_name_or_id", "").strip()
        stages_str = args.get("stages", "").strip()
        rules_str = args.get("rules", "").strip()
        on_failure = args.get("on_failure", "").strip()

        if not name:
            return _error_response("Workflow name is required.")
        if not description:
            return _error_response("Workflow description is required.")
        if not team_identifier:
            return _error_response("team_name_or_id is required.")
        if not stages_str:
            return _error_response("stages is required (JSON array of stage objects).")

        # Parse stages
        try:
            stages = json.loads(stages_str)
            if not isinstance(stages, list):
                return _error_response("stages must be a JSON array.")
        except json.JSONDecodeError:
            return _error_response("stages must be valid JSON.")

        # Parse rules
        rules: list[str] = []
        if rules_str:
            try:
                rules = json.loads(rules_str)
                if not isinstance(rules, list):
                    rules = [rules_str]
            except json.JSONDecodeError:
                rules = [r.strip() for r in rules_str.split(",") if r.strip()]

        # Resolve team
        team = get_team_by_name(_working_dir, team_identifier)
        if not team:
            team = get_team_by_id(_working_dir, team_identifier)
        if not team:
            return _error_response(f"Team '{team_identifier}' not found.")

        # Generate ID
        workflow_id = name.lower().replace(" ", "-").replace("_", "-")
        workflow_id = "".join(c for c in workflow_id if c.isalnum() or c == "-")

        # Check for existing
        try:
            filepath = _safe_path(f"workflows/{workflow_id}.json")
        except ValueError as e:
            return _error_response(str(e))

        if os.path.exists(filepath):
            return _error_response(
                f"Workflow '{workflow_id}' already exists. Use update_workflow to modify it."
            )

        # Build workflow JSON
        now = datetime.now(timezone.utc).isoformat()
        workflow = {
            "id": workflow_id,
            "name": name,
            "description": description,
            "created_at": now,
            "version": 1,
            "team": team["id"],
            "stages": stages,
            "rules": rules,
            "on_failure": on_failure or "Report back to the user before proceeding",
        }

        # Write workflow file
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, "w") as f:
            json.dump(workflow, f, indent=2)

        # Add workflow ID to team file
        try:
            team_data = load_team_file(_working_dir, team["id"])
            wf_list = team_data.get("workflows", [])
            if workflow_id not in wf_list:
                wf_list.append(workflow_id)
                update_team(_working_dir, team["id"], {"workflows": wf_list})
        except Exception:
            pass  # Workflow file saved — team link is non-critical

        return _text_response(
            f"Created workflow '{name}' ({workflow_id}) with {len(stages)} stages.\n"
            f"Assigned to team: {team['name']}"
        )

    except Exception as e:
        return _error_response(f"Failed to create workflow: {str(e)}")


@tool(
    "list_workflows",
    "List workflows with summaries (name, description, team, stage count). "
    "Optionally filter by team. Does NOT return full stage details — "
    "use read_workflow to load the complete workflow.",
    {"team_name_or_id": str},
)
async def list_workflows_tool(args: dict[str, Any]) -> dict[str, Any]:
    """List workflows with summary info."""
    try:
        team_filter = args.get("team_name_or_id", "").strip()
        workflows_dir = os.path.join(_working_dir, "workflows")

        if not os.path.isdir(workflows_dir):
            return _text_response("No workflows directory found. No workflows have been created yet.")

        files = sorted(f for f in os.listdir(workflows_dir) if f.endswith(".json"))
        if not files:
            return _text_response("No workflows found.")

        # Resolve team filter if provided
        filter_team_id = None
        if team_filter:
            team = get_team_by_name(_working_dir, team_filter)
            if not team:
                team = get_team_by_id(_working_dir, team_filter)
            if team:
                filter_team_id = team["id"]
            else:
                return _text_response(f"Team '{team_filter}' not found.")

        # Load team names for display
        teams_map: dict[str, str] = {}
        try:
            all_teams = get_teams(_working_dir)
            for t in all_teams:
                teams_map[t["id"]] = t["name"]
        except Exception:
            pass

        entries = []
        for fname in files:
            fpath = os.path.join(workflows_dir, fname)
            try:
                with open(fpath, "r") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue

            wf_team = data.get("team", "")
            if filter_team_id and wf_team != filter_team_id:
                continue

            team_name = teams_map.get(wf_team, wf_team)
            stage_count = len(data.get("stages", []))
            entries.append(
                f"  - {data.get('name', fname[:-5])} (ID: {data.get('id', fname[:-5])})\n"
                f"    Description: {data.get('description', '(none)')}\n"
                f"    Team: {team_name}\n"
                f"    Stages: {stage_count} | Version: {data.get('version', 1)}"
            )

        if not entries:
            if filter_team_id:
                return _text_response(f"No workflows found for team '{team_filter}'.")
            return _text_response("No workflows found.")

        header = f"Workflows ({len(entries)} total):\n"
        return _text_response(header + "\n".join(entries))

    except Exception as e:
        return _error_response(f"Failed to list workflows: {str(e)}")


@tool(
    "read_workflow",
    "Read the full content of a workflow including all stages, rules, and failure handling. "
    "Use list_workflows first to find the right workflow, then read it by name or ID.",
    {"name_or_id": str},
)
async def read_workflow_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Read a workflow's full JSON content."""
    try:
        name_or_id = args.get("name_or_id", "").strip()
        if not name_or_id:
            return _error_response("name_or_id is required.")

        filepath = _find_workflow(name_or_id)
        if not filepath:
            return _error_response(f"Workflow '{name_or_id}' not found in /working/workflows/.")

        with open(filepath, "r") as f:
            data = json.load(f)

        return _text_response(json.dumps(data, indent=2))

    except Exception as e:
        return _error_response(f"Failed to read workflow: {str(e)}")


@tool(
    "update_workflow",
    "Update an existing workflow. Can modify description, stages, rules, or failure handling. "
    "Increments the version number automatically. "
    "stages and rules must be JSON strings if provided.",
    {
        "name_or_id": str,
        "description": str,
        "stages": str,
        "rules": str,
        "on_failure": str,
    },
)
async def update_workflow_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Update a workflow with partial changes."""
    try:
        name_or_id = args.get("name_or_id", "").strip()
        if not name_or_id:
            return _error_response("name_or_id is required.")

        filepath = _find_workflow(name_or_id)
        if not filepath:
            return _error_response(f"Workflow '{name_or_id}' not found.")

        with open(filepath, "r") as f:
            data = json.load(f)

        old_version = data.get("version", 1)

        # Apply provided fields
        description = args.get("description", "").strip()
        if description:
            data["description"] = description

        stages_str = args.get("stages", "").strip()
        if stages_str:
            try:
                stages = json.loads(stages_str)
                if isinstance(stages, list):
                    data["stages"] = stages
            except json.JSONDecodeError:
                return _error_response("stages must be valid JSON.")

        rules_str = args.get("rules", "").strip()
        if rules_str:
            try:
                rules = json.loads(rules_str)
                if isinstance(rules, list):
                    data["rules"] = rules
            except json.JSONDecodeError:
                data["rules"] = [r.strip() for r in rules_str.split(",") if r.strip()]

        on_failure = args.get("on_failure", "").strip()
        if on_failure:
            data["on_failure"] = on_failure

        data["version"] = old_version + 1
        data["updated_at"] = datetime.now(timezone.utc).isoformat()

        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

        return _text_response(
            f"Updated workflow '{data.get('name', name_or_id)}' "
            f"(v{old_version} → v{data['version']})"
        )

    except Exception as e:
        return _error_response(f"Failed to update workflow: {str(e)}")


@tool(
    "delete_workflow",
    "Delete a workflow. Removes the workflow file and unlinks it from its team.",
    {"name_or_id": str},
)
async def delete_workflow_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delete a workflow and remove it from its team."""
    try:
        name_or_id = args.get("name_or_id", "").strip()
        if not name_or_id:
            return _error_response("name_or_id is required.")

        filepath = _find_workflow(name_or_id)
        if not filepath:
            return _error_response(f"Workflow '{name_or_id}' not found.")

        # Read workflow to get team reference
        with open(filepath, "r") as f:
            data = json.load(f)

        workflow_id = data.get("id", "")
        workflow_name = data.get("name", name_or_id)
        team_id = data.get("team", "")

        # Remove from team's workflows array
        if team_id:
            try:
                team_data = load_team_file(_working_dir, team_id)
                wf_list = team_data.get("workflows", [])
                if workflow_id in wf_list:
                    wf_list.remove(workflow_id)
                    update_team(_working_dir, team_id, {"workflows": wf_list})
            except Exception:
                pass  # Non-critical — file deletion is the primary action

        # Delete the workflow file
        os.remove(filepath)

        return _text_response(f"Deleted workflow '{workflow_name}' ({workflow_id}).")

    except Exception as e:
        return _error_response(f"Failed to delete workflow: {str(e)}")


@tool(
    "assign_workflow",
    "Assign a workflow to a different team. Moves the team reference from the old team to the new one.",
    {"workflow_name_or_id": str, "team_name_or_id": str},
)
async def assign_workflow_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Move a workflow from one team to another."""
    try:
        wf_identifier = args.get("workflow_name_or_id", "").strip()
        team_identifier = args.get("team_name_or_id", "").strip()

        if not wf_identifier:
            return _error_response("workflow_name_or_id is required.")
        if not team_identifier:
            return _error_response("team_name_or_id is required.")

        filepath = _find_workflow(wf_identifier)
        if not filepath:
            return _error_response(f"Workflow '{wf_identifier}' not found.")

        # Resolve target team
        target_team = get_team_by_name(_working_dir, team_identifier)
        if not target_team:
            target_team = get_team_by_id(_working_dir, team_identifier)
        if not target_team:
            return _error_response(f"Team '{team_identifier}' not found.")

        # Load workflow
        with open(filepath, "r") as f:
            data = json.load(f)

        workflow_id = data.get("id", "")
        old_team_id = data.get("team", "")

        # Remove from old team
        if old_team_id:
            try:
                old_team_data = load_team_file(_working_dir, old_team_id)
                wf_list = old_team_data.get("workflows", [])
                if workflow_id in wf_list:
                    wf_list.remove(workflow_id)
                    update_team(_working_dir, old_team_id, {"workflows": wf_list})
            except Exception:
                pass

        # Add to new team
        try:
            new_team_data = load_team_file(_working_dir, target_team["id"])
            wf_list = new_team_data.get("workflows", [])
            if workflow_id not in wf_list:
                wf_list.append(workflow_id)
                update_team(_working_dir, target_team["id"], {"workflows": wf_list})
        except Exception:
            pass

        # Update workflow's team field
        data["team"] = target_team["id"]
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

        return _text_response(
            f"Assigned workflow '{data.get('name', wf_identifier)}' to team '{target_team['name']}'."
        )

    except Exception as e:
        return _error_response(f"Failed to assign workflow: {str(e)}")


# ─── Gemini Subagent Tool (Phase 11) ────────────────────────────────


import logging as _logging

_gemini_logger = _logging.getLogger(__name__)


@tool(
    "gemini_task",
    "Delegate a task to a Gemini-powered subagent. The subagent runs prompt-in/text-out "
    "with no tool access. Use this tool when the target agent's platform is 'gemini'. "
    "After receiving the response, you (Clyde) should handle any file operations "
    "(Write, Edit, etc.) with the returned content.",
    {
        "agent_name": str,
        "task": str,
    },
)
async def gemini_task_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delegate a task to a Gemini subagent and return the response."""
    try:
        agent_name = args.get("agent_name", "").strip()
        task = args.get("task", "").strip()

        if not agent_name:
            return _error_response("agent_name is required.")
        if not task:
            return _error_response("task is required.")

        # Look up agent in registry
        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found in registry.")

        # Validate this is a Gemini agent
        platform = agent.get("platform", "claude")
        if platform != "gemini":
            return _error_response(
                f"Agent '{agent_name}' is a {platform} agent, not Gemini. "
                f"Use the Task tool for Claude agents."
            )

        # Resolve model ID
        model_tier = agent.get("model", "gemini-flash")
        model_id = GEMINI_MODEL_ID_MAP.get(model_tier)
        if not model_id:
            return _error_response(
                f"Unknown Gemini model tier '{model_tier}'. "
                f"Valid tiers: {', '.join(GEMINI_MODEL_ID_MAP.keys())}"
            )

        # Load system prompt
        prompt_path = agent.get("system_prompt_path", "")
        system_prompt = ""
        if prompt_path:
            abs_path = os.path.join(_working_dir, prompt_path.lstrip("/"))
            if os.path.exists(abs_path):
                with open(abs_path, "r") as f:
                    system_prompt = f.read()

        # Append agent memory if available
        memory_path = agent.get("memory_path", "")
        if memory_path:
            abs_mem = os.path.join(_working_dir, memory_path.lstrip("/"))
            if os.path.exists(abs_mem):
                with open(abs_mem, "r") as f:
                    memory_content = f.read().strip()
                if memory_content:
                    system_prompt += (
                        "\n\n## Your Memory (Accumulated Knowledge)\n\n"
                        "The following is your accumulated knowledge from previous tasks. "
                        "Use this context to inform your current work.\n\n"
                        f"{memory_content}"
                    )

        # Emit "started" activity event to frontend
        agent_display_name = agent.get("name", agent_name)
        agent_registry_id = agent.get("id", "")
        _ws = _ws_var.get()
        _session_id = _session_id_var.get()
        if _ws:
            try:
                await _ws.send_json({
                    "type": "agent_activity",
                    "data": {
                        "event": "started",
                        "agent_id": agent_registry_id,
                        "agent_type": agent_display_name,
                        "parent_agent": "",
                        "is_team_member": False,
                        "registry_id": agent_registry_id,
                        "name": agent_display_name,
                        "role": agent.get("role", "Gemini Subagent"),
                        "model": model_tier,
                        "avatar": agent.get("avatar", ""),
                    },
                })
            except Exception:
                pass

        # Persist started event to Supabase
        if _session_id:
            try:
                await save_activity_event(
                    session_id=_session_id,
                    agent_id=agent_registry_id,
                    agent_name=agent_display_name,
                    event_type="started",
                    description="Gemini agent started",
                    metadata={"platform": "gemini", "model": model_tier},
                )
            except Exception:
                pass

        # Call Gemini API
        result = await call_gemini(
            model=model_id,
            system_prompt=system_prompt,
            user_prompt=task,
        )

        # Emit "stopped" activity event to frontend
        if _ws:
            try:
                await _ws.send_json({
                    "type": "agent_activity",
                    "data": {
                        "event": "stopped",
                        "agent_id": agent_registry_id,
                        "agent_type": agent_display_name,
                        "parent_agent": "",
                        "is_team_member": False,
                        "registry_id": agent_registry_id,
                        "name": agent_display_name,
                        "model": model_tier,
                        "avatar": agent.get("avatar", ""),
                    },
                })
            except Exception:
                pass

        # Persist stopped event to Supabase
        if _session_id:
            try:
                await save_activity_event(
                    session_id=_session_id,
                    agent_id=agent_registry_id,
                    agent_name=agent_display_name,
                    event_type="stopped",
                    description="Gemini agent stopped",
                    metadata={"platform": "gemini", "model": model_tier},
                )
            except Exception:
                pass

        # Save cost record to Supabase for cost tracking
        _gemini_logger.info(
            f"[GEMINI] Cost tracking: session_id={_session_id!r}, "
            f"cost=${result['cost_usd']:.6f}"
        )
        if _session_id:
            try:
                await save_message(
                    session_id=_session_id,
                    role="agent",
                    content=result["content"][:500],
                    agent_name=agent.get("name", agent_name),
                    token_count=result["input_tokens"] + result["output_tokens"],
                    cost_usd=result["cost_usd"],
                    metadata={
                        "platform": "gemini",
                        "model": result["model"],
                        "model_tier": model_tier,
                        "input_tokens": result["input_tokens"],
                        "output_tokens": result["output_tokens"],
                    },
                )
                _gemini_logger.info("[GEMINI] Cost record saved successfully")
            except Exception as e:
                _gemini_logger.error(f"[GEMINI] Failed to save cost record: {e}", exc_info=True)
        else:
            _gemini_logger.warning("[GEMINI] No session_id — cost record NOT saved")

        # Return response to Clyde
        return _text_response(
            f"**{agent.get('name', agent_name)}** ({model_tier}) responded:\n\n"
            f"{result['content']}\n\n"
            f"---\n"
            f"Tokens: {result['input_tokens']} in / {result['output_tokens']} out | "
            f"Cost: ${result['cost_usd']:.6f}"
        )

    except Exception as e:
        return _error_response(f"Gemini task failed: {str(e)}")


# ─── Phase 12: OpenAI Subagent ─────────────────────────────────────

_openai_logger = _logging.getLogger("services.openai_client")


@tool(
    "openai_task",
    "Delegate a task to an OpenAI-powered subagent. The subagent runs prompt-in/text-out "
    "with no tool access. Use this tool when the target agent's platform is 'openai'. "
    "After receiving the response, you (Clyde) should handle any file operations "
    "(Write, Edit, etc.) with the returned content.",
    {
        "agent_name": str,
        "task": str,
    },
)
async def openai_task_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delegate a task to an OpenAI subagent and return the response."""
    try:
        agent_name = args.get("agent_name", "").strip()
        task = args.get("task", "").strip()

        if not agent_name:
            return _error_response("agent_name is required.")
        if not task:
            return _error_response("task is required.")

        # Look up agent in registry
        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found in registry.")

        # Validate this is an OpenAI agent
        platform = agent.get("platform", "claude")
        if platform != "openai":
            return _error_response(
                f"Agent '{agent_name}' is a {platform} agent, not OpenAI. "
                f"Use the Task tool for Claude agents or gemini_task for Gemini agents."
            )

        # Resolve model ID
        model_tier = agent.get("model", "gpt-5.4-mini")
        model_id = OPENAI_MODEL_ID_MAP.get(model_tier)
        if not model_id:
            return _error_response(
                f"Unknown OpenAI model tier '{model_tier}'. "
                f"Valid tiers: {', '.join(OPENAI_MODEL_ID_MAP.keys())}"
            )

        # Load system prompt
        prompt_path = agent.get("system_prompt_path", "")
        system_prompt = ""
        if prompt_path:
            abs_path = os.path.join(_working_dir, prompt_path.lstrip("/"))
            if os.path.exists(abs_path):
                with open(abs_path, "r") as f:
                    system_prompt = f.read()

        # Append agent memory if available
        memory_path = agent.get("memory_path", "")
        if memory_path:
            abs_mem = os.path.join(_working_dir, memory_path.lstrip("/"))
            if os.path.exists(abs_mem):
                with open(abs_mem, "r") as f:
                    memory_content = f.read().strip()
                if memory_content:
                    system_prompt += (
                        "\n\n## Your Memory (Accumulated Knowledge)\n\n"
                        "The following is your accumulated knowledge from previous tasks. "
                        "Use this context to inform your current work.\n\n"
                        f"{memory_content}"
                    )

        # Emit "started" activity event to frontend
        agent_display_name = agent.get("name", agent_name)
        agent_registry_id = agent.get("id", "")
        _ws = _ws_var.get()
        _session_id = _session_id_var.get()
        if _ws:
            try:
                await _ws.send_json({
                    "type": "agent_activity",
                    "data": {
                        "event": "started",
                        "agent_id": agent_registry_id,
                        "agent_type": agent_display_name,
                        "parent_agent": "",
                        "is_team_member": False,
                        "registry_id": agent_registry_id,
                        "name": agent_display_name,
                        "role": agent.get("role", "OpenAI Subagent"),
                        "model": model_tier,
                        "avatar": agent.get("avatar", ""),
                    },
                })
            except Exception:
                pass

        # Persist started event to Supabase
        if _session_id:
            try:
                await save_activity_event(
                    session_id=_session_id,
                    agent_id=agent_registry_id,
                    agent_name=agent_display_name,
                    event_type="started",
                    description="OpenAI agent started",
                    metadata={"platform": "openai", "model": model_tier},
                )
            except Exception:
                pass

        # Call OpenAI API
        result = await call_openai(
            model=model_id,
            system_prompt=system_prompt,
            user_prompt=task,
        )

        # Emit "stopped" activity event to frontend
        if _ws:
            try:
                await _ws.send_json({
                    "type": "agent_activity",
                    "data": {
                        "event": "stopped",
                        "agent_id": agent_registry_id,
                        "agent_type": agent_display_name,
                        "parent_agent": "",
                        "is_team_member": False,
                        "registry_id": agent_registry_id,
                        "name": agent_display_name,
                        "model": model_tier,
                        "avatar": agent.get("avatar", ""),
                    },
                })
            except Exception:
                pass

        # Persist stopped event to Supabase
        if _session_id:
            try:
                await save_activity_event(
                    session_id=_session_id,
                    agent_id=agent_registry_id,
                    agent_name=agent_display_name,
                    event_type="stopped",
                    description="OpenAI agent stopped",
                    metadata={"platform": "openai", "model": model_tier},
                )
            except Exception:
                pass

        # Save cost record to Supabase for cost tracking
        _openai_logger.info(
            f"[OPENAI] Cost tracking: session_id={_session_id!r}, "
            f"cost=${result['cost_usd']:.6f}"
        )
        if _session_id:
            try:
                await save_message(
                    session_id=_session_id,
                    role="agent",
                    content=result["content"][:500],
                    agent_name=agent.get("name", agent_name),
                    token_count=result["input_tokens"] + result["output_tokens"],
                    cost_usd=result["cost_usd"],
                    metadata={
                        "platform": "openai",
                        "model": result["model"],
                        "model_tier": model_tier,
                        "input_tokens": result["input_tokens"],
                        "output_tokens": result["output_tokens"],
                    },
                )
                _openai_logger.info("[OPENAI] Cost record saved successfully")
            except Exception as e:
                _openai_logger.error(f"[OPENAI] Failed to save cost record: {e}", exc_info=True)
        else:
            _openai_logger.warning("[OPENAI] No session_id — cost record NOT saved")

        # Return response to Clyde
        return _text_response(
            f"**{agent.get('name', agent_name)}** ({model_tier}) responded:\n\n"
            f"{result['content']}\n\n"
            f"---\n"
            f"Tokens: {result['input_tokens']} in / {result['output_tokens']} out | "
            f"Cost: ${result['cost_usd']:.6f}"
        )

    except Exception as e:
        return _error_response(f"OpenAI task failed: {str(e)}")


# ─── Phase 12B: Claude Subagent via OpenRouter ─────────────────────

_claude_or_logger = _logging.getLogger("services.openrouter_client")


@tool(
    "claude_task",
    "Delegate a task to a Claude-powered subagent via OpenRouter. The subagent runs "
    "prompt-in/text-out with no tool access. Use this tool when the target agent's "
    "platform is 'claude' and you are running in OpenRouter mode. After receiving the "
    "response, you (Clyde) should handle any file operations (Write, Edit, etc.) with "
    "the returned content.",
    {
        "agent_name": str,
        "task": str,
    },
)
async def claude_task_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Delegate a task to a Claude subagent via OpenRouter and return the response."""
    try:
        agent_name = args.get("agent_name", "").strip()
        task = args.get("task", "").strip()

        if not agent_name:
            return _error_response("agent_name is required.")
        if not task:
            return _error_response("task is required.")

        # Look up agent in registry
        agent = get_agent_by_name(_working_dir, agent_name)
        if not agent:
            return _error_response(f"Agent '{agent_name}' not found in registry.")

        # Validate this is a Claude agent
        platform = agent.get("platform", "claude")
        if platform != "claude":
            return _error_response(
                f"Agent '{agent_name}' is a {platform} agent, not Claude. "
                f"Use gemini_task for Gemini agents or openai_task for OpenAI agents."
            )

        # Resolve model — use openrouter_subagent_model from settings, or map the
        # agent's tier name to an OpenRouter model ID
        settings = load_settings(_working_dir)
        model_tier = agent.get("model", "sonnet")
        model_id = OPENROUTER_MODEL_ID_MAP.get(model_tier)
        if not model_id:
            # Fallback to the configured openrouter_subagent_model
            model_id = settings.get("openrouter_subagent_model", "anthropic/claude-haiku-4")

        # Load system prompt
        prompt_path = agent.get("system_prompt_path", "")
        system_prompt = ""
        if prompt_path:
            abs_path = os.path.join(_working_dir, prompt_path.lstrip("/"))
            if os.path.exists(abs_path):
                with open(abs_path, "r") as f:
                    system_prompt = f.read()

        # Append agent memory if available
        memory_path = agent.get("memory_path", "")
        if memory_path:
            abs_mem = os.path.join(_working_dir, memory_path.lstrip("/"))
            if os.path.exists(abs_mem):
                with open(abs_mem, "r") as f:
                    memory_content = f.read().strip()
                if memory_content:
                    system_prompt += (
                        "\n\n## Your Memory (Accumulated Knowledge)\n\n"
                        "The following is your accumulated knowledge from previous tasks. "
                        "Use this context to inform your current work.\n\n"
                        f"{memory_content}"
                    )

        # Inject file boundary rule
        abs_working = str(Path(_working_dir).resolve())
        system_prompt += (
            "\n\n## File Access Rules\n\n"
            "**CRITICAL**: You may ONLY read, write, and create files within "
            f"the working directory: `{abs_working}`\n\n"
            "- ALL file paths MUST be within this directory.\n"
            "- NEVER use paths starting with `~/`, `/Users/`, `/home/`, `/tmp/`.\n"
        )

        # Emit "started" activity event to frontend
        agent_display_name = agent.get("name", agent_name)
        agent_registry_id = agent.get("id", "")
        _ws = _ws_var.get()
        _session_id = _session_id_var.get()
        if _ws:
            try:
                await _ws.send_json({
                    "type": "agent_activity",
                    "data": {
                        "event": "started",
                        "agent_id": agent_registry_id,
                        "agent_type": agent_display_name,
                        "parent_agent": "",
                        "is_team_member": False,
                        "registry_id": agent_registry_id,
                        "name": agent_display_name,
                        "role": agent.get("role", "Claude Subagent"),
                        "model": model_tier,
                        "avatar": agent.get("avatar", ""),
                    },
                })
            except Exception:
                pass

        # Persist started event to Supabase
        if _session_id:
            try:
                await save_activity_event(
                    session_id=_session_id,
                    agent_id=agent_registry_id,
                    agent_name=agent_display_name,
                    event_type="started",
                    description="Claude agent started (OpenRouter)",
                    metadata={"platform": "claude", "model": model_tier, "via": "openrouter"},
                )
            except Exception:
                pass

        # Call OpenRouter API
        result = await call_openrouter(
            model=model_id,
            system_prompt=system_prompt,
            user_prompt=task,
        )

        # Emit "stopped" activity event to frontend
        if _ws:
            try:
                await _ws.send_json({
                    "type": "agent_activity",
                    "data": {
                        "event": "stopped",
                        "agent_id": agent_registry_id,
                        "agent_type": agent_display_name,
                        "parent_agent": "",
                        "is_team_member": False,
                        "registry_id": agent_registry_id,
                        "name": agent_display_name,
                        "model": model_tier,
                        "avatar": agent.get("avatar", ""),
                    },
                })
            except Exception:
                pass

        # Persist stopped event to Supabase
        if _session_id:
            try:
                await save_activity_event(
                    session_id=_session_id,
                    agent_id=agent_registry_id,
                    agent_name=agent_display_name,
                    event_type="stopped",
                    description="Claude agent stopped (OpenRouter)",
                    metadata={"platform": "claude", "model": model_tier, "via": "openrouter"},
                )
            except Exception:
                pass

        # Save cost record to Supabase
        _claude_or_logger.info(
            f"[CLAUDE_OR] Cost tracking: session_id={_session_id!r}, "
            f"cost=${result['cost_usd']:.6f}"
        )
        if _session_id:
            try:
                await save_message(
                    session_id=_session_id,
                    role="agent",
                    content=result["content"][:500],
                    agent_name=agent.get("name", agent_name),
                    token_count=result["input_tokens"] + result["output_tokens"],
                    cost_usd=result["cost_usd"],
                    metadata={
                        "platform": "claude",
                        "via": "openrouter",
                        "model": result["model"],
                        "model_tier": model_tier,
                        "input_tokens": result["input_tokens"],
                        "output_tokens": result["output_tokens"],
                    },
                )
                _claude_or_logger.info("[CLAUDE_OR] Cost record saved successfully")
            except Exception as e:
                _claude_or_logger.error(f"[CLAUDE_OR] Failed to save cost record: {e}", exc_info=True)
        else:
            _claude_or_logger.warning("[CLAUDE_OR] No session_id — cost record NOT saved")

        # Return response to Clyde
        return _text_response(
            f"**{agent.get('name', agent_name)}** ({model_tier} via OpenRouter) responded:\n\n"
            f"{result['content']}\n\n"
            f"---\n"
            f"Tokens: {result['input_tokens']} in / {result['output_tokens']} out | "
            f"Cost: ${result['cost_usd']:.6f}"
        )

    except Exception as e:
        return _error_response(f"Claude task (OpenRouter) failed: {str(e)}")


# ─── Visualisation Tools (Phase 13) ──────────────────────────────


@tool(
    "create_visualisation",
    "Render arbitrary self-contained HTML/SVG content as an inline visualisation in the "
    "chat. Use this for complex custom layouts, full HTML pages, or intricate SVG graphics "
    "that require complete control over the markup. For standard charts, prefer create_visual "
    "instead. The content renders in a sandboxed iframe with a dark theme background. "
    "Maximum 50,000 characters.",
    {
        "title": str,
        "html_content": str,
        "description": str,
    },
)
async def create_visualisation_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a legacy HTML/SVG visualisation rendered in a sandboxed iframe."""
    try:
        title = args.get("title", "").strip()
        html_content = args.get("html_content", "").strip()
        description = args.get("description", "").strip()

        if not title:
            return _error_response("title is required.")
        if not html_content:
            return _error_response("html_content is required.")
        if len(html_content) > 50_000:
            return _error_response(
                f"html_content is {len(html_content)} chars — maximum is 50,000."
            )

        vis_id = str(uuid.uuid4())
        payload: dict[str, Any] = {
            "vis_id": vis_id,
            "title": title,
            "html_content": html_content,
        }
        if description:
            payload["description"] = description

        _get_pending_visualizations().append(payload)

        # Push to frontend immediately via WebSocket
        _ws = _ws_var.get()
        if _ws:
            try:
                await _ws.send_json({"type": "visualization", "data": payload})
            except Exception:
                pass  # WebSocket may be closed; visualisation is still persisted

        return _text_response(
            f"Visualisation **{title}** rendered successfully (id: `{vis_id}`)."
        )

    except Exception as e:
        return _error_response(f"create_visualisation failed: {str(e)}")


@tool(
    "create_visual",
    "Create an inline data visualisation in the chat using either Chart.js (chart mode) "
    "or custom JavaScript (code mode). This is the preferred tool for creating visual "
    "content.\n\n"
    "**Chart mode** (`mode: \"chart\"`): Provide a Chart.js chart type and data/options "
    "objects. Supported types: bar, line, pie, doughnut, scatter, radar, polarArea, bubble.\n\n"
    "**Code mode** (`mode: \"code\"`): Write JavaScript that runs in a container with "
    "pre-loaded globals: canvas, ctx, svg, root, THEME, Chart, plus helpers svgEl(), "
    "svgText(), resizeCanvas(). Use this for custom diagrams, flowcharts, interactive "
    "SVG, or anything beyond standard charts.\n\n"
    "The THEME object provides dark palette colours: accent (#6366f1 indigo), "
    "secondary (#22d3ee cyan), tertiary (#f97316 orange), plus a palette[] array of 8 "
    "colours. Always use THEME colours for consistency.",
    {
        "title": str,
        "mode": str,
        "chart_type": str,
        "data": str,
        "options": str,
        "code": str,
        "description": str,
    },
)
async def create_visual_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Create a container-based visualisation (Chart.js chart or custom JS code)."""
    try:
        title = args.get("title", "").strip()
        mode = args.get("mode", "").strip().lower()
        description = args.get("description", "").strip()

        if not title:
            return _error_response("title is required.")
        if mode not in ("chart", "code"):
            return _error_response("mode must be 'chart' or 'code'.")

        vis_id = str(uuid.uuid4())
        payload: dict[str, Any] = {
            "vis_id": vis_id,
            "title": title,
            "mode": mode,
        }
        if description:
            payload["description"] = description

        if mode == "chart":
            chart_type = args.get("chart_type", "").strip().lower()
            data_raw = args.get("data", "")
            options_raw = args.get("options", "")

            valid_types = {
                "bar", "line", "pie", "doughnut", "scatter",
                "radar", "polarArea", "bubble",
            }
            if chart_type not in valid_types:
                return _error_response(
                    f"chart_type must be one of: {', '.join(sorted(valid_types))}."
                )

            # Parse data JSON
            if isinstance(data_raw, str):
                try:
                    data_obj = json.loads(data_raw) if data_raw else {}
                except json.JSONDecodeError as e:
                    return _error_response(f"data is not valid JSON: {e}")
            else:
                data_obj = data_raw or {}

            # Parse options JSON (optional)
            options_obj = {}
            if options_raw:
                if isinstance(options_raw, str):
                    try:
                        options_obj = json.loads(options_raw)
                    except json.JSONDecodeError as e:
                        return _error_response(f"options is not valid JSON: {e}")
                else:
                    options_obj = options_raw

            # Size guard
            combined = json.dumps(data_obj) + json.dumps(options_obj)
            if len(combined) > 20_000:
                return _error_response(
                    f"Chart data + options is {len(combined)} chars — maximum is 20,000."
                )

            payload["chart_type"] = chart_type
            payload["data"] = data_obj
            if options_obj:
                payload["options"] = options_obj

        elif mode == "code":
            code = args.get("code", "").strip()
            if not code:
                return _error_response("code is required in code mode.")
            if len(code) > 30_000:
                return _error_response(
                    f"code is {len(code)} chars — maximum is 30,000."
                )
            payload["code"] = code

        _get_pending_visuals().append(payload)

        # Push to frontend immediately via WebSocket
        _ws = _ws_var.get()
        if _ws:
            try:
                await _ws.send_json({"type": "visual", "data": payload})
            except Exception:
                pass

        return _text_response(
            f"Visual **{title}** ({mode} mode) rendered successfully (id: `{vis_id}`)."
        )

    except Exception as e:
        return _error_response(f"create_visual failed: {str(e)}")


# ─── Create the in-process MCP server (all tools) ─────────────────


registry_mcp_server = create_sdk_mcp_server(
    "registry_tools",
    version="5.0.0",
    tools=[
        # Phase 2: Agent registry
        create_agent_tool,
        list_agents_tool,
        update_agent_tool,
        delete_agent_tool,
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
        create_mcp_server_tool,
        list_mcp_servers_tool,
        update_mcp_server_tool,
        delete_mcp_server_tool,
        # Phase 5C: Self-Improvement
        review_agent_performance_tool,
        improve_agent_prompt_tool,
        update_agent_prompt_tool,
        analyse_team_gaps_tool,
        log_performance_tool,
        # Phase 6: Proactive Insights
        get_insights_tool,
        trigger_analysis_tool,
        # Phase 7: Task Board
        list_task_columns_tool,
        create_task_column_tool,
        delete_task_column_tool,
        list_tasks_tool,
        create_task_tool,
        update_task_tool,
        delete_task_tool,
        # Phase 8: Teams
        create_team_tool,
        list_teams_tool,
        update_team_tool,
        delete_team_tool,
        assign_agent_to_team_tool,
        remove_agent_from_team_tool,
        # Phase 9: Integrations (APIs & Webhooks)
        create_integration_tool,
        list_integrations_tool,
        get_integration_tool,
        update_integration_tool,
        delete_integration_tool,
        assign_integration_tool,
        call_integration_tool,
        # Phase 10: Workflows
        create_workflow_tool,
        list_workflows_tool,
        read_workflow_tool,
        update_workflow_tool,
        delete_workflow_tool,
        assign_workflow_tool,
        # Phase 11: Gemini Subagent
        gemini_task_tool,
        # Phase 12: OpenAI Subagent
        openai_task_tool,
        # Phase 12B: Claude Subagent via OpenRouter
        claude_task_tool,
        # Phase 13: Visualizations
        create_visualisation_tool,
        create_visual_tool,
    ],
)
