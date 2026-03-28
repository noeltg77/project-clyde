import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import create_client, Client

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client = create_client(url, key)
    return _client


def reset_client() -> None:
    """Clear the cached Supabase client so the next call to get_supabase()
    creates a fresh one with the current environment variables."""
    global _client
    _client = None


# --- Chat Sessions ---


async def create_session(title: str = "New Chat") -> dict:
    client = get_supabase()
    result = client.table("chat_sessions").insert({"title": title}).execute()
    return result.data[0]


async def save_message(
    session_id: str,
    role: str,
    content: str,
    embedding: list[float] | None = None,
    agent_id: str | None = None,
    agent_name: str | None = None,
    token_count: int = 0,
    cost_usd: float = 0.0,
    metadata: dict | None = None,
    created_at: str | None = None,
) -> dict:
    client = get_supabase()
    row: dict = {
        "session_id": session_id,
        "role": role,
        "content": content,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "token_count": token_count,
        "cost_usd": cost_usd,
        "metadata": metadata or {},
    }
    if embedding:
        row["embedding"] = embedding
    if created_at:
        row["created_at"] = created_at
    result = client.table("chat_messages").insert(row).execute()
    return result.data[0]


async def get_session_messages(session_id: str) -> list[dict]:
    client = get_supabase()
    result = (
        client.table("chat_messages")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
    )
    return result.data


async def search_messages(
    query_embedding: list[float],
    threshold: float = 0.3,
    limit: int = 10,
    session_id: str | None = None,
) -> list[dict]:
    client = get_supabase()
    params: dict = {
        "query_embedding": query_embedding,
        "match_threshold": threshold,
        "match_count": limit,
    }
    if session_id:
        params["filter_session_id"] = session_id
    result = client.rpc("match_chat_messages", params).execute()
    return result.data


# --- Session Management (Phase 3) ---


async def get_sessions(limit: int = 50) -> list[dict]:
    """List all sessions with message count, last message preview, and total cost.

    Uses batch queries instead of per-session lookups to avoid N+1 performance issues.
    """
    client = get_supabase()
    # Fetch sessions ordered by most recently updated
    sessions_result = (
        client.table("chat_sessions")
        .select("*")
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    sessions = sessions_result.data
    if not sessions:
        return []

    session_ids = [s["id"] for s in sessions]

    # Batch fetch all messages for these sessions (only the fields we need)
    all_messages = (
        client.table("chat_messages")
        .select("session_id, content, cost_usd, created_at")
        .in_("session_id", session_ids)
        .order("created_at", desc=True)
        .execute()
    ).data

    # Build per-session stats in a single pass
    msg_counts: dict[str, int] = defaultdict(int)
    total_costs: dict[str, float] = defaultdict(float)
    last_previews: dict[str, str] = {}

    for msg in all_messages:
        sid = msg["session_id"]
        msg_counts[sid] += 1
        total_costs[sid] += msg.get("cost_usd") or 0
        if sid not in last_previews:
            # First message per session is the latest (ordered desc)
            last_previews[sid] = (msg.get("content") or "")[:80]

    for session in sessions:
        sid = session["id"]
        session["message_count"] = msg_counts.get(sid, 0)
        session["total_cost"] = total_costs.get(sid, 0)
        session["last_message_preview"] = last_previews.get(sid, "")

    return sessions


async def delete_session(session_id: str) -> bool:
    """Delete a session and cascade-delete its messages."""
    client = get_supabase()
    # Delete messages first (explicit cascade for safety, in case DB cascade fails)
    client.table("chat_messages").delete().eq("session_id", session_id).execute()
    # Delete related activity events and permission logs
    client.table("activity_events").delete().eq("session_id", session_id).execute()
    client.table("permission_log").delete().eq("session_id", session_id).execute()
    # Delete the session itself
    result = client.table("chat_sessions").delete().eq("id", session_id).execute()
    return bool(result.data)


async def update_session_title(session_id: str, title: str) -> dict:
    """Update a session's title."""
    client = get_supabase()
    result = (
        client.table("chat_sessions")
        .update({"title": title})
        .eq("id", session_id)
        .execute()
    )
    return result.data[0] if result.data else {}


async def update_session_sdk_id(session_id: str, sdk_session_id: str) -> dict:
    """Store the Claude SDK session ID in the session's metadata."""
    client = get_supabase()
    # Fetch current metadata to merge (avoid overwriting other fields)
    current = (
        client.table("chat_sessions")
        .select("metadata")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    meta = (current.data[0].get("metadata") or {}) if current.data else {}
    meta["sdk_session_id"] = sdk_session_id
    result = (
        client.table("chat_sessions")
        .update({"metadata": meta})
        .eq("id", session_id)
        .execute()
    )
    return result.data[0] if result.data else {}


async def get_session(session_id: str) -> dict | None:
    """Get a session record by ID (includes metadata with sdk_session_id)."""
    client = get_supabase()
    result = (
        client.table("chat_sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


# --- Activity Events ---


async def save_activity_event(
    session_id: str | None,
    agent_id: str,
    agent_name: str,
    event_type: str,
    description: str | None = None,
    metadata: dict | None = None,
) -> dict:
    """Insert an activity event for the live feed."""
    client = get_supabase()
    row: dict = {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "event_type": event_type,
        "description": description,
        "metadata": metadata or {},
    }
    if session_id:
        row["session_id"] = session_id
    result = client.table("activity_events").insert(row).execute()
    return result.data[0]


async def get_activity_events(session_id: str, limit: int = 100) -> list[dict]:
    """Fetch activity events for a session, ordered oldest-first."""
    client = get_supabase()
    result = (
        client.table("activity_events")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
    )
    return result.data


async def get_recently_active_agents(days: int = 30) -> set[str]:
    """Return the set of agent_name values that appear in activity_events within the last N days."""
    client = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    result = (
        client.table("activity_events")
        .select("agent_name")
        .gte("created_at", cutoff)
        .execute()
    )
    return {row["agent_name"] for row in result.data if row.get("agent_name")}


# --- Permission Log ---


async def save_permission_decision(
    session_id: str | None,
    agent_id: str | None,
    agent_name: str | None,
    tool_name: str,
    tool_input: dict | None = None,
    decision: str = "deny",
) -> dict:
    """Log a permission decision."""
    client = get_supabase()
    row: dict = {
        "tool_name": tool_name,
        "tool_input": tool_input or {},
        "decision": decision,
    }
    if session_id:
        row["session_id"] = session_id
    if agent_id:
        row["agent_id"] = agent_id
    if agent_name:
        row["agent_name"] = agent_name
    result = client.table("permission_log").insert(row).execute()
    return result.data[0]


# --- System Prompt History (Phase 5B) ---


async def save_prompt_change(
    agent_id: str,
    previous_version: str | None,
    new_version: str,
    reason: str,
    changed_by: str = "user",
) -> dict:
    """Log a system prompt change to system_prompt_history."""
    client = get_supabase()
    row = {
        "agent_id": agent_id,
        "previous_version": previous_version or "",
        "new_version": new_version,
        "reason": reason,
        "changed_by": changed_by,
    }
    result = client.table("system_prompt_history").insert(row).execute()
    return result.data[0] if result.data else {}


async def get_prompt_history(agent_id: str, limit: int = 20) -> list[dict]:
    """Get system prompt version history for an agent, newest first."""
    client = get_supabase()
    result = (
        client.table("system_prompt_history")
        .select("*")
        .eq("agent_id", agent_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data


async def get_prompt_version(version_id: str) -> dict | None:
    """Get a specific prompt version by its UUID."""
    client = get_supabase()
    result = (
        client.table("system_prompt_history")
        .select("*")
        .eq("id", version_id)
        .execute()
    )
    return result.data[0] if result.data else None


# --- Cost Tracking (Phase 4B) ---


async def get_cost_summary(days: int = 14, range_type: str | None = None) -> dict:
    """Get cost aggregates for a configurable date range.

    Args:
        days: Number of days to look back (7, 14, 30, 90, 180, 365).
        range_type: Optional preset - "mtd" (month-to-date) or "ytd" (year-to-date).
                    When set, overrides the days parameter.
    """
    client = get_supabase()
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())  # Monday
    month_start = today_start.replace(day=1)

    # Determine the range start based on range_type or days
    if range_type == "mtd":
        range_start = month_start
    elif range_type == "ytd":
        range_start = today_start.replace(month=1, day=1)
    else:
        range_start = today_start - timedelta(days=days)

    # Fetch all messages within the range with cost data
    result = (
        client.table("chat_messages")
        .select("cost_usd, agent_name, created_at, metadata")
        .gte("created_at", range_start.isoformat())
        .execute()
    )
    messages = result.data

    # Compute aggregates
    today_usd = 0.0
    week_usd = 0.0
    month_usd = 0.0
    range_usd = 0.0
    agent_costs: dict[str, dict] = defaultdict(
        lambda: {"cost_usd": 0.0, "message_count": 0}
    )
    daily_costs: dict[str, float] = defaultdict(float)
    daily_platform_costs: dict[str, dict[str, float]] = defaultdict(
        lambda: defaultdict(float)
    )
    platform_costs: dict[str, dict] = defaultdict(
        lambda: {"cost_usd": 0.0, "message_count": 0}
    )

    for msg in messages:
        cost = msg.get("cost_usd") or 0.0
        if cost <= 0:
            continue

        created_at = msg.get("created_at", "")
        agent = msg.get("agent_name") or "Unknown"
        metadata = msg.get("metadata") or {}
        platform = metadata.get("platform", "claude")

        try:
            msg_time = datetime.fromisoformat(
                created_at.replace("Z", "+00:00")
            )
        except (ValueError, AttributeError):
            continue

        # Date aggregates
        date_key = msg_time.strftime("%Y-%m-%d")
        daily_costs[date_key] += cost
        daily_platform_costs[date_key][platform] += cost

        range_usd += cost

        if msg_time >= today_start:
            today_usd += cost
        if msg_time >= week_start:
            week_usd += cost
        if msg_time >= month_start:
            month_usd += cost

        # Per-agent
        agent_costs[agent]["cost_usd"] += cost
        agent_costs[agent]["message_count"] += 1

        # Per-platform
        platform_costs[platform]["cost_usd"] += cost
        platform_costs[platform]["message_count"] += 1

    # Build response
    by_agent = [
        {
            "name": name,
            "cost_usd": round(data["cost_usd"], 4),
            "message_count": data["message_count"],
        }
        for name, data in sorted(
            agent_costs.items(), key=lambda x: x[1]["cost_usd"], reverse=True
        )
    ]

    by_platform = [
        {
            "platform": name,
            "cost_usd": round(data["cost_usd"], 4),
            "message_count": data["message_count"],
        }
        for name, data in sorted(
            platform_costs.items(), key=lambda x: x[1]["cost_usd"], reverse=True
        )
    ]

    # Calculate the actual number of days in the range for the daily breakdown
    range_days = (today_start - range_start).days + 1

    # Build daily breakdown with per-platform split
    daily_breakdown = []
    for i in range(range_days):
        d = range_start + timedelta(days=i)
        date_key = d.strftime("%Y-%m-%d")
        cost_usd = daily_costs.get(date_key, 0.0)
        platform_split = daily_platform_costs.get(date_key, {})
        daily_breakdown.append({
            "date": date_key,
            "cost_usd": round(cost_usd, 4),
            "claude": round(platform_split.get("claude", 0.0), 4),
            "gemini": round(platform_split.get("gemini", 0.0), 4),
            "openai": round(platform_split.get("openai", 0.0), 4),
            "openrouter": round(platform_split.get("openrouter", 0.0), 4),
        })

    return {
        "today_usd": round(today_usd, 4),
        "week_usd": round(week_usd, 4),
        "month_usd": round(month_usd, 4),
        "range_usd": round(range_usd, 4),
        "by_agent": by_agent,
        "by_platform": by_platform,
        "daily_breakdown": daily_breakdown,
    }


# --- Proactive Insights (Phase 6A) ---


async def save_insight(
    insight_type: str,
    title: str,
    description: str,
    severity: str = "info",
    data: dict | None = None,
) -> dict:
    """Insert a new proactive insight."""
    client = get_supabase()
    row = {
        "insight_type": insight_type,
        "title": title,
        "description": description,
        "severity": severity,
        "data": data or {},
    }
    result = client.table("proactive_insights").insert(row).execute()
    return result.data[0] if result.data else {}


async def get_pending_insights(limit: int = 20) -> list[dict]:
    """Get insights that are pending and not currently snoozed."""
    client = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()
    # Fetch pending insights — snoozed ones only if snooze has expired
    result = (
        client.table("proactive_insights")
        .select("*")
        .eq("status", "pending")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    # Filter out actively snoozed insights client-side
    insights = []
    for row in result.data:
        snoozed = row.get("snoozed_until")
        if snoozed and snoozed > now_iso:
            continue
        insights.append(row)
    return insights


async def get_all_insights(limit: int = 50) -> list[dict]:
    """Get all insights ordered by creation date, newest first."""
    client = get_supabase()
    result = (
        client.table("proactive_insights")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data


async def update_insight_status(
    insight_id: str,
    status: str,
    snoozed_until: str | None = None,
) -> dict:
    """Update an insight's status (dismiss, snooze, act)."""
    client = get_supabase()
    update_data: dict = {"status": status}
    if snoozed_until:
        update_data["snoozed_until"] = snoozed_until
    result = (
        client.table("proactive_insights")
        .update(update_data)
        .eq("id", insight_id)
        .execute()
    )
    return result.data[0] if result.data else {}


async def delete_insight(insight_id: str) -> bool:
    """Permanently delete an insight by ID."""
    client = get_supabase()
    result = (
        client.table("proactive_insights")
        .delete()
        .eq("id", insight_id)
        .execute()
    )
    return len(result.data) > 0


async def get_recent_message_contents(
    days: int = 7, limit: int = 200
) -> list[dict]:
    """Fetch recent user message contents for pattern analysis."""
    client = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    result = (
        client.table("chat_messages")
        .select("content, session_id, created_at")
        .eq("role", "user")
        .gte("created_at", cutoff)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data


# --- Task Board (Kanban) ---


async def get_task_columns() -> list[dict]:
    """List all task columns ordered by position."""
    client = get_supabase()
    result = (
        client.table("task_columns")
        .select("*")
        .order("position")
        .execute()
    )
    return result.data


async def create_task_column(name: str, position: int) -> dict:
    """Create a new task column."""
    client = get_supabase()
    result = (
        client.table("task_columns")
        .insert({"name": name, "position": position})
        .execute()
    )
    return result.data[0] if result.data else {}


async def update_task_column(column_id: str, **fields) -> dict:
    """Update a task column's name and/or position."""
    client = get_supabase()
    update_data = {k: v for k, v in fields.items() if v is not None}
    if not update_data:
        return {}
    result = (
        client.table("task_columns")
        .update(update_data)
        .eq("id", column_id)
        .execute()
    )
    return result.data[0] if result.data else {}


async def delete_task_column(column_id: str) -> bool:
    """Delete a task column (tasks in the column are cascade-deleted)."""
    client = get_supabase()
    result = (
        client.table("task_columns")
        .delete()
        .eq("id", column_id)
        .execute()
    )
    return len(result.data) > 0


async def get_tasks() -> list[dict]:
    """Get all tasks ordered by position."""
    client = get_supabase()
    result = (
        client.table("tasks")
        .select("*")
        .order("position")
        .execute()
    )
    return result.data


async def create_task(
    title: str,
    column_id: str,
    description: str = "",
    assignee_type: str | None = None,
    assignee_id: str | None = None,
    assignee_name: str | None = None,
    linked_docs: list[dict] | None = None,
    session_id: str | None = None,
) -> dict:
    """Create a new task card."""
    client = get_supabase()
    # Auto-calculate position: append to end of column
    existing = (
        client.table("tasks")
        .select("position")
        .eq("column_id", column_id)
        .order("position", desc=True)
        .limit(1)
        .execute()
    )
    next_pos = (existing.data[0]["position"] + 1) if existing.data else 0

    row: dict[str, Any] = {
        "title": title,
        "description": description,
        "column_id": column_id,
        "position": next_pos,
        "linked_docs": linked_docs or [],
    }
    if assignee_type:
        row["assignee_type"] = assignee_type
    if assignee_id:
        row["assignee_id"] = assignee_id
    if assignee_name:
        row["assignee_name"] = assignee_name
    if session_id:
        row["session_id"] = session_id
    result = client.table("tasks").insert(row).execute()
    return result.data[0] if result.data else {}


async def update_task(task_id: str, **fields) -> dict:
    """Partial update of a task (title, description, column_id, position, assignee, linked_docs)."""
    client = get_supabase()
    allowed = {
        "title", "description", "column_id", "position",
        "assignee_type", "assignee_id", "assignee_name",
        "linked_docs", "session_id",
    }
    update_data = {k: v for k, v in fields.items() if k in allowed}
    if not update_data:
        return {}
    result = (
        client.table("tasks")
        .update(update_data)
        .eq("id", task_id)
        .execute()
    )
    return result.data[0] if result.data else {}


async def delete_task(task_id: str) -> bool:
    """Delete a task by ID."""
    client = get_supabase()
    result = (
        client.table("tasks")
        .delete()
        .eq("id", task_id)
        .execute()
    )
    return len(result.data) > 0


async def reorder_tasks(updates: list[dict]) -> bool:
    """Batch-update task positions. Each item: {id, column_id, position}."""
    client = get_supabase()
    for item in updates:
        client.table("tasks").update({
            "column_id": item["column_id"],
            "position": item["position"],
        }).eq("id", item["id"]).execute()
    return True


# --- Integrations (APIs & Webhooks) ---


async def get_integrations(type_filter: str | None = None) -> list[dict]:
    """Get all integrations, optionally filtered by type ('api' or 'webhook')."""
    client = get_supabase()
    query = client.table("integrations").select("*").order("created_at", desc=True)
    if type_filter:
        query = query.eq("type", type_filter)
    result = query.execute()
    return result.data


async def get_integration(integration_id: str) -> dict | None:
    """Get a single integration by ID."""
    client = get_supabase()
    result = (
        client.table("integrations")
        .select("*")
        .eq("id", integration_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


async def create_integration(
    name: str,
    int_type: str,
    base_url: str = "",
    method: str = "GET",
    auth_type: str = "none",
    credential_env_key: str | None = None,
    headers: dict | None = None,
    description: str = "",
    documentation_url: str | None = None,
    assigned_agents: list[str] | None = None,
    metadata: dict | None = None,
) -> dict:
    """Create a new integration (API or webhook)."""
    client = get_supabase()
    row = {
        "name": name,
        "type": int_type,
        "base_url": base_url,
        "method": method,
        "auth_type": auth_type,
        "credential_env_key": credential_env_key,
        "headers": headers or {},
        "description": description,
        "documentation_url": documentation_url,
        "assigned_agents": assigned_agents or [],
        "metadata": metadata or {},
    }
    result = client.table("integrations").insert(row).execute()
    return result.data[0] if result.data else {}


async def update_integration(integration_id: str, **fields) -> dict:
    """Partial update of an integration."""
    client = get_supabase()
    allowed = {
        "name", "type", "base_url", "method", "auth_type",
        "credential_env_key", "headers", "description",
        "documentation_url", "assigned_agents", "enabled", "metadata",
    }
    update_data = {k: v for k, v in fields.items() if k in allowed}
    if not update_data:
        return {}
    result = (
        client.table("integrations")
        .update(update_data)
        .eq("id", integration_id)
        .execute()
    )
    return result.data[0] if result.data else {}


async def delete_integration(integration_id: str) -> bool:
    """Delete an integration by ID."""
    client = get_supabase()
    result = (
        client.table("integrations")
        .delete()
        .eq("id", integration_id)
        .execute()
    )
    return len(result.data) > 0
