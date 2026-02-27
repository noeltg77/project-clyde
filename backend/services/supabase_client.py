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
    """List all sessions with message count, last message preview, and total cost."""
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

    # Enrich each session with message stats
    for session in sessions:
        sid = session["id"]
        # Get message count and total cost
        msgs = (
            client.table("chat_messages")
            .select("content, role, cost_usd, created_at")
            .eq("session_id", sid)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        count_result = (
            client.table("chat_messages")
            .select("id", count="exact")
            .eq("session_id", sid)
            .execute()
        )
        cost_result = (
            client.table("chat_messages")
            .select("cost_usd")
            .eq("session_id", sid)
            .execute()
        )
        session["message_count"] = count_result.count or 0
        session["total_cost"] = sum(
            (m.get("cost_usd") or 0) for m in cost_result.data
        )
        if msgs.data:
            last = msgs.data[0]
            session["last_message_preview"] = (last.get("content") or "")[:80]
        else:
            session["last_message_preview"] = ""

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


async def get_cost_summary(usd_to_gbp_rate: float = 0.79) -> dict:
    """Get cost aggregates: today, this week, this month, per-agent, daily breakdown."""
    client = get_supabase()
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())  # Monday
    month_start = today_start.replace(day=1)
    thirty_days_ago = today_start - timedelta(days=30)

    # Fetch all messages from the last 30 days with cost data
    result = (
        client.table("chat_messages")
        .select("cost_usd, agent_name, created_at")
        .gte("created_at", thirty_days_ago.isoformat())
        .execute()
    )
    messages = result.data

    # Compute aggregates
    today_usd = 0.0
    week_usd = 0.0
    month_usd = 0.0
    agent_costs: dict[str, dict] = defaultdict(
        lambda: {"cost_usd": 0.0, "message_count": 0}
    )
    daily_costs: dict[str, float] = defaultdict(float)

    for msg in messages:
        cost = msg.get("cost_usd") or 0.0
        if cost <= 0:
            continue

        created_at = msg.get("created_at", "")
        agent = msg.get("agent_name") or "Unknown"

        try:
            msg_time = datetime.fromisoformat(
                created_at.replace("Z", "+00:00")
            )
        except (ValueError, AttributeError):
            continue

        # Date aggregates
        date_key = msg_time.strftime("%Y-%m-%d")
        daily_costs[date_key] += cost

        if msg_time >= today_start:
            today_usd += cost
        if msg_time >= week_start:
            week_usd += cost
        if msg_time >= month_start:
            month_usd += cost

        # Per-agent
        agent_costs[agent]["cost_usd"] += cost
        agent_costs[agent]["message_count"] += 1

    # Build response
    by_agent = [
        {
            "name": name,
            "cost_gbp": round(data["cost_usd"] * usd_to_gbp_rate, 4),
            "cost_usd": round(data["cost_usd"], 4),
            "message_count": data["message_count"],
        }
        for name, data in sorted(
            agent_costs.items(), key=lambda x: x[1]["cost_usd"], reverse=True
        )
    ]

    # Build daily breakdown (last 14 days)
    daily_breakdown = []
    for i in range(14):
        d = today_start - timedelta(days=13 - i)
        date_key = d.strftime("%Y-%m-%d")
        cost_usd = daily_costs.get(date_key, 0.0)
        daily_breakdown.append({
            "date": date_key,
            "cost_gbp": round(cost_usd * usd_to_gbp_rate, 4),
            "cost_usd": round(cost_usd, 4),
        })

    return {
        "today_gbp": round(today_usd * usd_to_gbp_rate, 4),
        "week_gbp": round(week_usd * usd_to_gbp_rate, 4),
        "month_gbp": round(month_usd * usd_to_gbp_rate, 4),
        "today_usd": round(today_usd, 4),
        "week_usd": round(week_usd, 4),
        "month_usd": round(month_usd, 4),
        "exchange_rate": usd_to_gbp_rate,
        "by_agent": by_agent,
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
