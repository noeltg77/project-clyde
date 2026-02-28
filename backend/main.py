import asyncio
import base64
import logging
import mimetypes
import os
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from pathlib import Path
import shutil

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

from agents.clyde import ClydeChatManager
from services.supabase_client import (
    create_session,
    save_message,
    get_session_messages,
    get_sessions,
    get_session,
    delete_session,
    update_session_title,
    update_session_sdk_id,
    search_messages,
    save_activity_event,
    get_activity_events,
    save_permission_decision,
    get_cost_summary,
    save_prompt_change,
    get_prompt_history,
    get_prompt_version,
    get_pending_insights,
    get_all_insights,
    update_insight_status,
    delete_insight,
)
from services.embeddings import generate_embedding, generate_query_embedding
from services.registry import load_registry, save_registry
from services.settings import load_settings, update_settings
from services.scheduler import TaskScheduler
from services.file_watcher import FileWatcherService
from services.performance_logger import PerformanceLogger
from services.proactive_engine import ProactiveEngine
from services.sleep_prevention import SleepPrevention

# Load environment from project root
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))

WORKING_DIR = os.environ.get(
    "WORKING_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "working"),
)

def _safe_resolve(relative_path: str) -> Path:
    """Resolve a path relative to WORKING_DIR, rejecting traversal attacks.

    Raises ValueError if the resolved path escapes the working directory.
    Returns the resolved absolute Path.
    """
    working = Path(WORKING_DIR).resolve()
    target = (working / relative_path).resolve()
    if not str(target).startswith(str(working)):
        raise ValueError(f"Path traversal blocked: {relative_path}")
    return target


# Phase 4B: Cost tracking (USD)

# Phase 4C/4D: Scheduler and file watcher instances
_scheduler: TaskScheduler | None = None
_file_watcher: FileWatcherService | None = None

# Phase 5A: Performance logger instance
_performance_logger: PerformanceLogger | None = None

# Phase 6: Proactive engine and connected WS clients for broadcast
_proactive_engine: ProactiveEngine | None = None
_connected_clients: set[WebSocket] = set()

# Sleep prevention service
_sleep_prevention: SleepPrevention | None = None


async def _broadcast_insights(insights: list[dict]):
    """Broadcast new proactive insights to all connected WebSocket clients."""
    if not insights:
        return
    stale: list[WebSocket] = []
    for client in _connected_clients:
        for insight in insights:
            try:
                await client.send_json({
                    "type": "proactive_insight",
                    "data": insight,
                })
            except Exception:
                stale.append(client)
                break
    for s in stale:
        _connected_clients.discard(s)


async def broadcast_session_created(session: dict):
    """Broadcast a new session to all connected clients (for scheduler/trigger sessions)."""
    stale: list[WebSocket] = []
    for client in _connected_clients:
        try:
            await client.send_json({
                "type": "background_session_created",
                "data": {
                    "session_id": session["id"],
                    "title": session.get("title", "New Chat"),
                    "created_at": session.get("created_at", ""),
                },
            })
        except Exception:
            stale.append(client)
    for s in stale:
        _connected_clients.discard(s)


async def _run_proactive_analysis():
    """Scheduled callback: run the proactive engine and broadcast results."""
    if not _proactive_engine:
        return
    try:
        settings = load_settings(WORKING_DIR)
        if not settings.get("proactive_mode_enabled", True):
            logger.info("[Proactive] Proactive mode disabled — skipping")
            return
        new_insights = await _proactive_engine.run_analysis()
        await _broadcast_insights(new_insights)
    except Exception as e:
        logger.error(f"[Proactive] Scheduled analysis failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler, _file_watcher, _performance_logger, _proactive_engine, _sleep_prevention

    # Startup
    print(f"[Clyde Backend] Working directory: {WORKING_DIR}")

    # Phase 4C: Start task scheduler
    _scheduler = TaskScheduler(WORKING_DIR)
    _scheduler.start()
    print(f"[Clyde Backend] Scheduler started")

    # Phase 4D: Start file watcher
    _file_watcher = FileWatcherService(WORKING_DIR)
    await _file_watcher.start()
    print(f"[Clyde Backend] File watcher started")

    # Phase 5A: Performance logger
    _performance_logger = PerformanceLogger(WORKING_DIR)
    print(f"[Clyde Backend] Performance logger initialised")

    # Phase 6: Proactive engine + scheduled job
    _proactive_engine = ProactiveEngine(WORKING_DIR)
    settings = load_settings(WORKING_DIR)
    interval_hours = max(1, min(24, settings.get("proactive_interval_hours", 6)))
    if _scheduler:
        from apscheduler.triggers.cron import CronTrigger

        # */24 is invalid for cron hours (range 0-23); 24h means "once daily at midnight"
        cron_hour = "0" if interval_hours >= 24 else f"*/{interval_hours}"
        _scheduler.scheduler.add_job(
            _run_proactive_analysis,
            trigger=CronTrigger(hour=cron_hour),
            id="proactive-insights",
            replace_existing=True,
        )
    print(f"[Clyde Backend] Proactive engine initialised (interval: {interval_hours}h)")

    # Sleep prevention (start if enabled in settings)
    _sleep_prevention = SleepPrevention()
    if settings.get("prevent_sleep_enabled", False):
        if _sleep_prevention.start():
            print(f"[Clyde Backend] Sleep prevention active ({_sleep_prevention.platform_name}: {_sleep_prevention.method_description})")
        else:
            print(f"[Clyde Backend] Sleep prevention failed to start on {_sleep_prevention.platform_name}")
    else:
        print("[Clyde Backend] Sleep prevention disabled")

    # Ensure uploads directory exists
    os.makedirs(os.path.join(WORKING_DIR, "uploads"), exist_ok=True)

    yield

    # Shutdown
    if _sleep_prevention:
        _sleep_prevention.stop()
    if _file_watcher:
        await _file_watcher.stop()
    if _scheduler:
        _scheduler.stop()
    print("[Clyde Backend] Shutting down")


app = FastAPI(title="Project Clyde Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3020", "http://127.0.0.1:3020"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "working_dir": WORKING_DIR}


@app.get("/api/agents")
async def get_agents():
    """Return all agents from the registry for the org chart and activity panel."""
    try:
        registry = load_registry(WORKING_DIR)
        return {
            "orchestrator": registry.get("orchestrator", {}),
            "agents": registry.get("agents", []),
        }
    except Exception as e:
        return {"orchestrator": {}, "agents": [], "error": str(e)}


# --- Session CRUD (Phase 3) ---


@app.get("/api/sessions")
async def list_sessions():
    """List all chat sessions with metadata."""
    try:
        sessions = await get_sessions(limit=50)
        return {"sessions": sessions}
    except Exception as e:
        logger.error(f"[API] Failed to list sessions: {e}")
        return {"sessions": [], "error": str(e)}


@app.post("/api/sessions")
async def create_new_session():
    """Create a new chat session."""
    try:
        session = await create_session("New Chat")
        return {"session": session}
    except Exception as e:
        logger.error(f"[API] Failed to create session: {e}")
        return {"error": str(e)}


@app.delete("/api/sessions/{session_id}")
async def remove_session(session_id: str):
    """Delete a chat session and all its messages."""
    try:
        deleted = await delete_session(session_id)
        logger.info(f"[API] Session deleted: {session_id} (result={deleted})")
        return {"deleted": True}
    except Exception as e:
        logger.error(f"[API] Failed to delete session {session_id}: {e}", exc_info=True)
        return {"deleted": False, "error": str(e)}


@app.patch("/api/sessions/{session_id}")
async def patch_session(session_id: str, body: dict):
    """Update a session's title."""
    try:
        title = body.get("title", "").strip()
        if not title:
            return {"error": "Title is required"}
        updated = await update_session_title(session_id, title)
        return {"session": updated}
    except Exception as e:
        logger.error(f"[API] Failed to update session: {e}")
        return {"error": str(e)}


# --- Search (Phase 3) ---


@app.get("/api/search")
async def search_chat_history(q: str, session_id: str | None = None):
    """Semantic search across chat history using vector similarity."""
    try:
        if not q.strip():
            return {"results": []}
        embedding = await generate_query_embedding(q.strip())
        results = await search_messages(
            query_embedding=embedding,
            threshold=0.3,
            limit=10,
            session_id=session_id,
        )
        return {"results": results, "query": q}
    except Exception as e:
        logger.error(f"[API] Search failed: {e}")
        return {"results": [], "error": str(e)}


# --- Skills (Phase 3) ---


@app.get("/api/skills")
async def list_skills():
    """List all skill documents from the working directory."""
    try:
        skills_dir = os.path.join(WORKING_DIR, "skills")
        if not os.path.isdir(skills_dir):
            return {"skills": []}

        skills = []
        registry = load_registry(WORKING_DIR)
        # Build a map of skill → assigned agents
        skill_agents: dict[str, list[str]] = {}
        for agent in registry.get("agents", []):
            for skill_name in agent.get("skills", []):
                skill_agents.setdefault(skill_name, []).append(agent["name"])

        for fname in sorted(os.listdir(skills_dir)):
            if not fname.endswith(".md"):
                continue
            skill_name = fname[:-3]  # remove .md
            fpath = os.path.join(skills_dir, fname)
            with open(fpath, "r") as f:
                first_line = f.readline().strip().lstrip("# ").strip()
                content = f.read()

            # Extract version from content if present
            version = "1.0"
            for line in content.split("\n"):
                if line.strip().lower().startswith("**version:**"):
                    version = line.split(":", 1)[1].strip().strip("*")
                    break

            skills.append({
                "name": skill_name,
                "title": first_line or skill_name,
                "version": version,
                "assigned_to": skill_agents.get(skill_name, []),
                "file": f"skills/{fname}",
            })

        return {"skills": skills}
    except Exception as e:
        logger.error(f"[API] Failed to list skills: {e}")
        return {"skills": [], "error": str(e)}


# --- Cost Tracking (Phase 4B) ---


@app.get("/api/cost")
async def get_cost():
    """Get cost aggregates: today, week, month, per-agent, daily breakdown."""
    try:
        summary = await get_cost_summary()
        return summary
    except Exception as e:
        logger.error(f"[API] Cost query failed: {e}")
        return {"error": str(e), "today_usd": 0, "week_usd": 0, "month_usd": 0}


# --- Schedules (Phase 4C) ---


@app.get("/api/schedules")
async def list_schedules():
    """List all scheduled tasks."""
    try:
        if _scheduler:
            schedules = await _scheduler.list_schedules()
            return {"schedules": schedules}
        return {"schedules": []}
    except Exception as e:
        logger.error(f"[API] Failed to list schedules: {e}")
        return {"schedules": [], "error": str(e)}


@app.post("/api/schedules")
async def create_schedule(body: dict):
    """Create a new scheduled task (recurring or one-off)."""
    try:
        if not _scheduler:
            return {"error": "Scheduler not available"}

        name = body.get("name", "").strip()
        schedule_type = body.get("schedule_type", "recurring").strip()
        cron = (body.get("cron") or "").strip() or None
        run_at = (body.get("run_at") or "").strip() or None
        prompt = body.get("prompt", "").strip()
        agent_name = (body.get("agent_name") or "").strip() or None

        if not name or not prompt:
            return {"error": "name and prompt are required"}
        if schedule_type == "recurring" and not cron:
            return {"error": "cron is required for recurring schedules"}
        if schedule_type == "one_off" and not run_at:
            return {"error": "run_at is required for one-off schedules"}

        schedule = await _scheduler.add_schedule(
            name,
            prompt,
            agent_name,
            schedule_type=schedule_type,
            cron=cron,
            run_at=run_at,
        )
        return {"schedule": schedule}
    except Exception as e:
        logger.error(f"[API] Failed to create schedule: {e}")
        return {"error": str(e)}


@app.delete("/api/schedules/{schedule_id}")
async def remove_schedule(schedule_id: str):
    """Remove a scheduled task."""
    try:
        if _scheduler:
            await _scheduler.remove_schedule(schedule_id)
            return {"deleted": True}
        return {"deleted": False, "error": "Scheduler not available"}
    except Exception as e:
        logger.error(f"[API] Failed to delete schedule: {e}")
        return {"deleted": False, "error": str(e)}


@app.patch("/api/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, body: dict):
    """Update or pause/resume a scheduled task."""
    try:
        if not _scheduler:
            return {"error": "Scheduler not available"}

        # If body has "toggle_enabled", toggle pause/resume
        if body.get("toggle_enabled"):
            result = await _scheduler.pause_schedule(schedule_id)
            if result:
                schedules = await _scheduler.list_schedules()
                updated = next((s for s in schedules if s["id"] == schedule_id), None)
                return {"schedule": updated}
            return {"error": "Schedule not found"}

        # Otherwise, update fields
        updated = await _scheduler.update_schedule(schedule_id, body)
        if updated:
            return {"schedule": updated}
        return {"error": "Schedule not found"}
    except Exception as e:
        logger.error(f"[API] Failed to update schedule: {e}")
        return {"error": str(e)}


# --- Triggers (Phase 4D) ---


@app.get("/api/triggers")
async def list_triggers():
    """List all file triggers."""
    try:
        if _file_watcher:
            triggers = await _file_watcher.list_triggers()
            return {"triggers": triggers}
        return {"triggers": []}
    except Exception as e:
        logger.error(f"[API] Failed to list triggers: {e}")
        return {"triggers": [], "error": str(e)}


@app.post("/api/triggers")
async def create_trigger(body: dict):
    """Create a new file trigger."""
    try:
        if not _file_watcher:
            return {"error": "File watcher not available"}
        name = body.get("name", "").strip()
        watch_path = body.get("watch_path", "").strip()
        pattern = body.get("pattern", "").strip()
        prompt = body.get("prompt", "").strip()
        agent_name = (body.get("agent_name") or "").strip() or None
        if not name or not watch_path or not pattern or not prompt:
            return {"error": "name, watch_path, pattern, and prompt are required"}
        trigger = await _file_watcher.add_trigger(name, watch_path, pattern, prompt, agent_name)
        return {"trigger": trigger}
    except Exception as e:
        logger.error(f"[API] Failed to create trigger: {e}")
        return {"error": str(e)}


@app.delete("/api/triggers/{trigger_id}")
async def remove_trigger(trigger_id: str):
    """Remove a file trigger."""
    try:
        if _file_watcher:
            await _file_watcher.remove_trigger(trigger_id)
            return {"deleted": True}
        return {"deleted": False, "error": "File watcher not available"}
    except Exception as e:
        logger.error(f"[API] Failed to delete trigger: {e}")
        return {"deleted": False, "error": str(e)}


@app.patch("/api/triggers/{trigger_id}")
async def update_trigger(trigger_id: str, body: dict):
    """Update or enable/disable a file trigger."""
    try:
        if not _file_watcher:
            return {"error": "File watcher not available"}

        if body.get("toggle_enabled"):
            # Find and toggle
            triggers = await _file_watcher.list_triggers()
            for t in triggers:
                if t["id"] == trigger_id:
                    updated = await _file_watcher.update_trigger(
                        trigger_id, {"enabled": not t.get("enabled", True)}
                    )
                    return {"trigger": updated}
            return {"error": "Trigger not found"}

        updated = await _file_watcher.update_trigger(trigger_id, body)
        if updated:
            return {"trigger": updated}
        return {"error": "Trigger not found"}
    except Exception as e:
        logger.error(f"[API] Failed to update trigger: {e}")
        return {"error": str(e)}


# --- Performance (Phase 5A) ---


@app.get("/api/performance")
async def get_performance():
    """Aggregated performance stats across all agents."""
    try:
        if _performance_logger:
            stats = _performance_logger.get_all_stats(days=30)
            return stats
        return {"total_tasks": 0, "by_agent": []}
    except Exception as e:
        logger.error(f"[API] Performance query failed: {e}")
        return {"error": str(e), "total_tasks": 0}


@app.get("/api/performance/{agent_id}")
async def get_agent_performance(agent_id: str):
    """Performance stats for a specific agent."""
    try:
        if _performance_logger:
            stats = _performance_logger.get_agent_stats(agent_id, days=30)
            return stats
        return {"agent_id": agent_id, "total_tasks": 0}
    except Exception as e:
        logger.error(f"[API] Agent performance query failed: {e}")
        return {"error": str(e)}


@app.post("/api/performance/feedback")
async def record_performance_feedback(body: dict):
    """Record user feedback (positive/negative) on a performance entry."""
    try:
        session_id = body.get("session_id", "")
        message_timestamp = body.get("message_timestamp", "")
        feedback = body.get("feedback", "")
        if feedback not in ("positive", "negative"):
            return {"error": "feedback must be 'positive' or 'negative'"}
        if _performance_logger:
            updated = _performance_logger.record_feedback(
                session_id, message_timestamp, feedback
            )
            return {"updated": updated}
        return {"updated": False}
    except Exception as e:
        logger.error(f"[API] Feedback recording failed: {e}")
        return {"error": str(e)}


# --- Proactive Insights (Phase 6) ---


@app.get("/api/insights")
async def list_insights(status: str | None = None):
    """List all insights, optionally filtered by status."""
    try:
        if status == "pending":
            insights = await get_pending_insights(limit=20)
        else:
            insights = await get_all_insights(limit=50)
        return {"insights": insights}
    except Exception as e:
        logger.error(f"[API] Failed to list insights: {e}")
        return {"insights": [], "error": str(e)}


@app.get("/api/insights/pending")
async def list_pending_insights():
    """Get pending insights for frontend polling."""
    try:
        insights = await get_pending_insights(limit=20)
        return {"insights": insights}
    except Exception as e:
        logger.error(f"[API] Failed to list pending insights: {e}")
        return {"insights": [], "error": str(e)}


@app.patch("/api/insights/{insight_id}")
async def patch_insight(insight_id: str, body: dict):
    """Update an insight's status (dismiss, snooze, act)."""
    try:
        status = body.get("status", "")
        if status not in ("dismissed", "snoozed", "acted_upon"):
            return {"error": "status must be dismissed, snoozed, or acted_upon"}
        snoozed_until = body.get("snoozed_until")
        result = await update_insight_status(insight_id, status, snoozed_until)
        return {"insight": result}
    except Exception as e:
        logger.error(f"[API] Failed to update insight: {e}")
        return {"error": str(e)}


@app.delete("/api/insights/{insight_id}")
async def remove_insight(insight_id: str):
    """Permanently delete an insight."""
    try:
        deleted = await delete_insight(insight_id)
        if not deleted:
            return {"error": "Insight not found"}
        return {"deleted": True, "id": insight_id}
    except Exception as e:
        logger.error(f"[API] Failed to delete insight: {e}")
        return {"error": str(e)}


@app.get("/api/insights/next-run")
async def get_next_proactive_run():
    """Return the next scheduled proactive analysis run time."""
    try:
        if _scheduler:
            job = _scheduler.scheduler.get_job("proactive-insights")
            if job and job.next_run_time:
                return {"next_run_time": job.next_run_time.isoformat()}
        return {"next_run_time": None}
    except Exception as e:
        logger.error(f"[API] Failed to get next run time: {e}")
        return {"next_run_time": None}


@app.post("/api/insights/trigger")
async def trigger_proactive_analysis():
    """Manually trigger the proactive analysis engine."""
    try:
        if not _proactive_engine:
            return {"error": "Proactive engine not available"}
        new_insights = await _proactive_engine.run_analysis()
        # Broadcast to connected clients
        await _broadcast_insights(new_insights)
        return {
            "triggered": True,
            "new_insights_count": len(new_insights),
            "insights": new_insights,
        }
    except Exception as e:
        logger.error(f"[API] Manual insight trigger failed: {e}")
        return {"error": str(e), "triggered": False}


# --- System Prompt Management (Phase 5B) ---


@app.get("/api/prompts/{agent_id}/history")
async def get_prompt_history_endpoint(agent_id: str):
    """Get system prompt version history for an agent."""
    try:
        history = await get_prompt_history(agent_id, limit=20)
        return {"history": history}
    except Exception as e:
        logger.error(f"[API] Prompt history query failed: {e}")
        return {"history": [], "error": str(e)}


@app.get("/api/prompts/{agent_id}/current")
async def get_current_prompt(agent_id: str):
    """Read the current system prompt content from disk."""
    try:
        registry = load_registry(WORKING_DIR)

        # Find the prompt path for the given agent
        prompt_path = None
        if registry.get("orchestrator", {}).get("id") == agent_id:
            prompt_path = registry["orchestrator"].get("system_prompt_path", "")
        else:
            for agent in registry.get("agents", []):
                if agent["id"] == agent_id or agent["name"].lower() == agent_id.lower():
                    prompt_path = agent.get("system_prompt_path", "")
                    break

        if not prompt_path:
            return {"error": "Agent not found", "content": ""}

        # Convert relative path to absolute
        abs_path = os.path.join(
            WORKING_DIR,
            prompt_path.replace("/working/", "", 1),
        )

        if not os.path.exists(abs_path):
            return {"error": "Prompt file not found", "content": ""}

        with open(abs_path, "r") as f:
            content = f.read()

        return {
            "content": content,
            "path": prompt_path,
            "agent_id": agent_id,
            "char_count": len(content),
        }
    except Exception as e:
        logger.error(f"[API] Get current prompt failed: {e}")
        return {"error": str(e), "content": ""}


@app.put("/api/prompts/{agent_id}")
async def update_prompt(agent_id: str, body: dict):
    """User manually edits a prompt. Logs the change to history."""
    try:
        new_content = body.get("content", "").strip()
        reason = body.get("reason", "Manual edit").strip()
        if not new_content:
            return {"error": "Content is required"}

        registry = load_registry(WORKING_DIR)

        # Find prompt path
        prompt_path = None
        if registry.get("orchestrator", {}).get("id") == agent_id:
            prompt_path = registry["orchestrator"].get("system_prompt_path", "")
        else:
            for agent in registry.get("agents", []):
                if agent["id"] == agent_id or agent["name"].lower() == agent_id.lower():
                    prompt_path = agent.get("system_prompt_path", "")
                    break

        if not prompt_path:
            return {"error": "Agent not found"}

        abs_path = os.path.join(
            WORKING_DIR,
            prompt_path.replace("/working/", "", 1),
        )

        # Read old version
        old_content = ""
        if os.path.exists(abs_path):
            with open(abs_path, "r") as f:
                old_content = f.read()

        # Write new version
        with open(abs_path, "w") as f:
            f.write(new_content)

        # Log to Supabase history
        history_entry = await save_prompt_change(
            agent_id=agent_id,
            previous_version=old_content,
            new_version=new_content,
            reason=reason,
            changed_by="user",
        )

        return {"success": True, "history_entry": history_entry}
    except Exception as e:
        logger.error(f"[API] Update prompt failed: {e}")
        return {"error": str(e)}


@app.post("/api/prompts/{agent_id}/rollback/{version_id}")
async def rollback_prompt(agent_id: str, version_id: str):
    """Roll back an agent's prompt to a specific version."""
    try:
        # Fetch the target version
        version = await get_prompt_version(version_id)
        if not version:
            return {"error": "Version not found"}

        # The version we're rolling back TO is the `new_version` of that entry
        target_content = version.get("new_version", "")
        if not target_content:
            return {"error": "Version has no content"}

        registry = load_registry(WORKING_DIR)

        # Find prompt path
        prompt_path = None
        if registry.get("orchestrator", {}).get("id") == agent_id:
            prompt_path = registry["orchestrator"].get("system_prompt_path", "")
        else:
            for agent in registry.get("agents", []):
                if agent["id"] == agent_id or agent["name"].lower() == agent_id.lower():
                    prompt_path = agent.get("system_prompt_path", "")
                    break

        if not prompt_path:
            return {"error": "Agent not found"}

        abs_path = os.path.join(
            WORKING_DIR,
            prompt_path.replace("/working/", "", 1),
        )

        # Read current version
        old_content = ""
        if os.path.exists(abs_path):
            with open(abs_path, "r") as f:
                old_content = f.read()

        # Write the rolled-back version
        with open(abs_path, "w") as f:
            f.write(target_content)

        # Log the rollback to history
        history_entry = await save_prompt_change(
            agent_id=agent_id,
            previous_version=old_content,
            new_version=target_content,
            reason=f"Rolled back to version {version_id}",
            changed_by="user",
        )

        return {"success": True, "history_entry": history_entry}
    except Exception as e:
        logger.error(f"[API] Prompt rollback failed: {e}")
        return {"error": str(e)}


# --- Registry Settings (Phase 5B) ---


@app.get("/api/registry/settings")
async def get_registry_settings():
    """Get user settings from settings.json (with defaults applied)."""
    try:
        return load_settings(WORKING_DIR)
    except Exception as e:
        logger.error(f"[API] Get settings failed: {e}")
        return {"error": str(e)}


@app.patch("/api/registry/settings")
async def update_registry_settings(body: dict):
    """Update user settings in settings.json."""
    try:
        # Validate and coerce individual fields
        updates: dict[str, Any] = {}

        if "self_edit_enabled" in body:
            updates["self_edit_enabled"] = bool(body["self_edit_enabled"])
        if "concurrency_cap" in body:
            updates["concurrency_cap"] = max(1, min(10, int(body["concurrency_cap"])))
        if "max_team_size" in body:
            updates["max_team_size"] = max(1, min(5, int(body["max_team_size"])))
        if "cost_alert_threshold_usd" in body:
            updates["cost_alert_threshold_usd"] = float(body["cost_alert_threshold_usd"])
        if "proactive_mode_enabled" in body:
            updates["proactive_mode_enabled"] = bool(body["proactive_mode_enabled"])
        if "proactive_interval_hours" in body:
            hours = max(1, min(24, int(body["proactive_interval_hours"])))
            updates["proactive_interval_hours"] = hours
            # Re-register the scheduled job with the new interval
            if _scheduler:
                try:
                    from apscheduler.triggers.cron import CronTrigger

                    cron_hour = "0" if hours >= 24 else f"*/{hours}"
                    _scheduler.scheduler.add_job(
                        _run_proactive_analysis,
                        trigger=CronTrigger(hour=cron_hour),
                        id="proactive-insights",
                        replace_existing=True,
                    )
                except Exception as e:
                    logger.warning(f"[API] Failed to reschedule proactive job: {e}")
        if "save_uploads_enabled" in body:
            updates["save_uploads_enabled"] = bool(body["save_uploads_enabled"])
        if "prompt_caching_enabled" in body:
            updates["prompt_caching_enabled"] = bool(body["prompt_caching_enabled"])
        if "prevent_sleep_enabled" in body:
            enabled = bool(body["prevent_sleep_enabled"])
            updates["prevent_sleep_enabled"] = enabled
            # Start or stop the service in real-time
            if _sleep_prevention:
                if enabled and not _sleep_prevention.is_active:
                    _sleep_prevention.start()
                    logger.info("[API] Sleep prevention started via settings toggle")
                elif not enabled and _sleep_prevention.is_active:
                    _sleep_prevention.stop()
                    logger.info("[API] Sleep prevention stopped via settings toggle")

        if updates:
            update_settings(WORKING_DIR, updates)
        return {"success": True}
    except Exception as e:
        logger.error(f"[API] Update settings failed: {e}")
        return {"error": str(e)}


# --- Environment Variable Management ---

# Only these vars can be read/written via the API
_ENV_WHITELIST = {
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
}

_ENV_FILE_PATH = os.path.join(os.path.dirname(__file__), "..", ".env.local")


@app.get("/api/env-vars")
async def get_env_vars():
    """Read whitelisted environment variables from .env.local."""
    try:
        env_vars: dict[str, str] = {k: "" for k in _ENV_WHITELIST}
        if os.path.exists(_ENV_FILE_PATH):
            with open(_ENV_FILE_PATH, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        key, _, value = line.partition("=")
                        key = key.strip()
                        if key in _ENV_WHITELIST:
                            env_vars[key] = value.strip()
        return {"vars": env_vars}
    except Exception as e:
        logger.error(f"[API] Get env vars failed: {e}")
        return {"error": str(e)}


@app.patch("/api/env-vars")
async def update_env_vars(body: dict):
    """Update whitelisted environment variables in .env.local."""
    try:
        # Filter to only whitelisted keys
        updates = {k: v for k, v in body.items() if k in _ENV_WHITELIST}
        if not updates:
            return {"error": "No valid environment variables provided"}

        # Read current file
        lines: list[str] = []
        if os.path.exists(_ENV_FILE_PATH):
            with open(_ENV_FILE_PATH, "r") as f:
                lines = f.readlines()

        # Track which keys we've updated in-place
        updated_keys: set[str] = set()

        new_lines: list[str] = []
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                key = stripped.partition("=")[0].strip()
                if key in updates:
                    new_lines.append(f"{key}={updates[key]}\n")
                    updated_keys.add(key)
                    continue
            new_lines.append(line)

        # Append any keys that weren't found in the file
        for key, value in updates.items():
            if key not in updated_keys:
                new_lines.append(f"\n{key}={value}\n")

        # Write back
        with open(_ENV_FILE_PATH, "w") as f:
            f.writelines(new_lines)

        # Update os.environ so the running backend picks up changes
        for key, value in updates.items():
            if value:
                os.environ[key] = value
            elif key in os.environ:
                del os.environ[key]

        logger.info(f"[API] Updated env vars: {list(updates.keys())}")
        return {"success": True}
    except Exception as e:
        logger.error(f"[API] Update env vars failed: {e}")
        return {"error": str(e)}


# --- Agent Management REST (Phase 5D) ---


@app.patch("/api/agents/{registry_id}")
async def update_agent_rest(registry_id: str, body: dict):
    """Update an agent's status or configuration via REST."""
    try:
        from services.registry import update_agent

        # Pass the body dict as the updates parameter
        result = update_agent(WORKING_DIR, registry_id, body)
        return {"agent": result}
    except Exception as e:
        logger.error(f"[API] Update agent failed: {e}")
        return {"error": str(e)}


# --- Export/Import (Phase 5E) ---


@app.get("/api/system/export")
async def export_system():
    """Export the full system state as a JSON bundle."""
    try:
        bundle: dict = {
            "export_version": "1.0",
            "exported_at": datetime.now(timezone.utc).isoformat(),
        }

        # Registry
        try:
            registry = load_registry(WORKING_DIR)
            bundle["registry"] = registry
        except Exception:
            bundle["registry"] = {}

        # Schedules
        schedules_path = os.path.join(WORKING_DIR, "schedules.json")
        if os.path.exists(schedules_path):
            with open(schedules_path, "r") as f:
                bundle["schedules"] = json.load(f)
        else:
            bundle["schedules"] = {}

        # Triggers
        triggers_path = os.path.join(WORKING_DIR, "triggers.json")
        if os.path.exists(triggers_path):
            with open(triggers_path, "r") as f:
                bundle["triggers"] = json.load(f)
        else:
            bundle["triggers"] = {}

        # Prompts (all .md in working/prompts/)
        prompts = {}
        prompts_dir = os.path.join(WORKING_DIR, "prompts")
        if os.path.isdir(prompts_dir):
            for fname in os.listdir(prompts_dir):
                if fname.endswith(".md"):
                    with open(os.path.join(prompts_dir, fname), "r") as f:
                        prompts[fname] = f.read()
        bundle["prompts"] = prompts

        # Skills
        skills = {}
        skills_dir = os.path.join(WORKING_DIR, "skills")
        if os.path.isdir(skills_dir):
            for fname in os.listdir(skills_dir):
                if fname.endswith(".md"):
                    with open(os.path.join(skills_dir, fname), "r") as f:
                        skills[fname] = f.read()
        bundle["skills"] = skills

        # Memory
        memory = {}
        memory_dir = os.path.join(WORKING_DIR, "memory")
        if os.path.isdir(memory_dir):
            for fname in os.listdir(memory_dir):
                if fname.endswith(".md"):
                    with open(os.path.join(memory_dir, fname), "r") as f:
                        memory[fname] = f.read()
        bundle["memory"] = memory

        return bundle
    except Exception as e:
        logger.error(f"[API] Export failed: {e}")
        return {"error": str(e)}


@app.post("/api/system/import")
async def import_system(body: dict):
    """Import system state from a JSON bundle. Backs up current state first."""
    try:
        from datetime import datetime as dt

        # Create backup
        backup_dir = os.path.join(
            WORKING_DIR,
            "backups",
            dt.now().strftime("%Y%m%d-%H%M%S"),
        )
        os.makedirs(backup_dir, exist_ok=True)

        # Backup current files
        for subdir in ["prompts", "skills", "memory"]:
            src_dir = os.path.join(WORKING_DIR, subdir)
            dst_dir = os.path.join(backup_dir, subdir)
            if os.path.isdir(src_dir):
                os.makedirs(dst_dir, exist_ok=True)
                for fname in os.listdir(src_dir):
                    src = os.path.join(src_dir, fname)
                    if os.path.isfile(src):
                        with open(src, "r") as f:
                            content = f.read()
                        with open(os.path.join(dst_dir, fname), "w") as f:
                            f.write(content)

        for fname in ["registry.json", "schedules.json", "triggers.json"]:
            src = os.path.join(WORKING_DIR, fname)
            if os.path.exists(src):
                with open(src, "r") as f:
                    content = f.read()
                with open(os.path.join(backup_dir, fname), "w") as f:
                    f.write(content)

        # Import registry
        if "registry" in body and body["registry"]:
            save_registry(WORKING_DIR, body["registry"])

        # Import schedules
        if "schedules" in body:
            with open(os.path.join(WORKING_DIR, "schedules.json"), "w") as f:
                json.dump(body["schedules"], f, indent=2)

        # Import triggers
        if "triggers" in body:
            with open(os.path.join(WORKING_DIR, "triggers.json"), "w") as f:
                json.dump(body["triggers"], f, indent=2)

        # Import prompts
        if "prompts" in body:
            prompts_dir = os.path.join(WORKING_DIR, "prompts")
            os.makedirs(prompts_dir, exist_ok=True)
            for fname, content in body["prompts"].items():
                with open(os.path.join(prompts_dir, fname), "w") as f:
                    f.write(content)

        # Import skills
        if "skills" in body:
            skills_dir = os.path.join(WORKING_DIR, "skills")
            os.makedirs(skills_dir, exist_ok=True)
            for fname, content in body["skills"].items():
                with open(os.path.join(skills_dir, fname), "w") as f:
                    f.write(content)

        # Import memory
        if "memory" in body:
            memory_dir = os.path.join(WORKING_DIR, "memory")
            os.makedirs(memory_dir, exist_ok=True)
            for fname, content in body["memory"].items():
                with open(os.path.join(memory_dir, fname), "w") as f:
                    f.write(content)

        return {"success": True, "backup_dir": backup_dir}
    except Exception as e:
        logger.error(f"[API] Import failed: {e}")
        return {"error": str(e)}


# ─── File Management API ───────────────────────────────────────────


@app.get("/api/files")
async def list_files(path: str = ""):
    """List contents of a directory within the working dir."""
    try:
        target = _safe_resolve(path)
        if not target.is_dir():
            return {"error": "Not a directory", "items": []}

        items = []
        for entry in sorted(
            target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())
        ):
            if entry.name.startswith("."):
                continue  # Skip hidden files
            stat = entry.stat()
            items.append({
                "name": entry.name,
                "type": "folder" if entry.is_dir() else "file",
                "size": stat.st_size if entry.is_file() else None,
                "modified_at": datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).isoformat(),
            })
        return {"items": items, "path": path}
    except ValueError as e:
        return {"error": str(e), "items": []}
    except Exception as e:
        logger.error(f"[API] List files failed: {e}")
        return {"error": str(e), "items": []}


@app.post("/api/files/mkdir")
async def create_directory(body: dict):
    """Create a new directory within the working dir."""
    try:
        rel_path = body.get("path", "").strip()
        if not rel_path:
            return {"error": "Path is required"}
        target = _safe_resolve(rel_path)
        if target.exists():
            return {"error": "Path already exists"}
        target.mkdir(parents=True, exist_ok=False)
        return {"success": True, "path": rel_path}
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"[API] mkdir failed: {e}")
        return {"error": str(e)}


@app.post("/api/files/upload")
async def upload_files(
    files: list[UploadFile] = File(...),
    path: str = Form(""),
):
    """Upload one or more files to a directory within the working dir."""
    try:
        target_dir = _safe_resolve(path)
        if not target_dir.is_dir():
            return {"error": f"Target directory does not exist: {path}"}

        uploaded = []
        for file in files:
            if not file.filename:
                continue
            file_path = _safe_resolve(
                os.path.join(path, file.filename) if path else file.filename
            )
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)
            uploaded.append(file.filename)

        return {"success": True, "uploaded": uploaded}
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"[API] Upload failed: {e}")
        return {"error": str(e)}


@app.get("/api/files/download")
async def download_file(path: str):
    """Download a single file from the working dir."""
    try:
        target = _safe_resolve(path)
        if not target.is_file():
            return {"error": "File not found"}
        return FileResponse(
            path=str(target),
            filename=target.name,
            media_type="application/octet-stream",
        )
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"[API] Download failed: {e}")
        return {"error": str(e)}


# MIME types treated as editable text even though they don't start with "text/"
_TEXT_MIME_EXTRAS = {
    "application/json",
    "application/javascript",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
    "application/x-sh",
    "application/x-python",
    "application/sql",
    "application/graphql",
}

# Extensions we know are text, even if mimetypes module guesses wrong
_TEXT_EXTENSIONS = {
    ".md", ".mdx", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".scss", ".html", ".htm",
    ".xml", ".svg", ".sh", ".bash", ".zsh", ".fish", ".env", ".ini", ".cfg",
    ".conf", ".log", ".csv", ".sql", ".graphql", ".gql", ".rs", ".go",
    ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp", ".rb", ".php",
    ".lua", ".r", ".m", ".pl", ".ps1",
}

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"}
_PDF_EXTENSIONS = {".pdf"}


def _is_text_file(target: Path) -> bool:
    """Check if a file should be treated as editable text."""
    ext = target.suffix.lower()
    if ext in _TEXT_EXTENSIONS:
        return True
    mime, _ = mimetypes.guess_type(str(target))
    if mime and (mime.startswith("text/") or mime in _TEXT_MIME_EXTRAS):
        return True
    return False


@app.get("/api/files/read")
async def read_file_content(path: str):
    """Read a file's content for viewing/editing in the file viewer modal."""
    try:
        target = _safe_resolve(path)
        if not target.is_file():
            return {"error": "File not found"}

        file_size = target.stat().st_size
        ext = target.suffix.lower()
        mime, _ = mimetypes.guess_type(str(target))
        mime = mime or "application/octet-stream"

        # Text files — return raw content for editing
        if _is_text_file(target):
            if file_size > 5 * 1024 * 1024:  # 5MB limit
                return {"error": "File too large to edit (max 5MB)"}
            content = target.read_text(encoding="utf-8", errors="replace")
            return {
                "content": content,
                "path": path,
                "name": target.name,
                "size": file_size,
                "mime_type": mime,
                "editable": True,
            }

        # Images — return base64 data URI
        if ext in _IMAGE_EXTENSIONS:
            if file_size > 10 * 1024 * 1024:  # 10MB limit
                return {"error": "Image too large to preview (max 10MB)"}
            raw = target.read_bytes()
            b64 = base64.b64encode(raw).decode("ascii")
            data_uri = f"data:{mime};base64,{b64}"
            return {
                "content": data_uri,
                "path": path,
                "name": target.name,
                "size": file_size,
                "mime_type": mime,
                "editable": False,
            }

        # PDFs — return base64 data URI
        if ext in _PDF_EXTENSIONS:
            if file_size > 10 * 1024 * 1024:  # 10MB limit
                return {"error": "PDF too large to preview (max 10MB)"}
            raw = target.read_bytes()
            b64 = base64.b64encode(raw).decode("ascii")
            data_uri = f"data:application/pdf;base64,{b64}"
            return {
                "content": data_uri,
                "path": path,
                "name": target.name,
                "size": file_size,
                "mime_type": "application/pdf",
                "editable": False,
            }

        # Unsupported — return metadata only, no content
        return {
            "content": None,
            "path": path,
            "name": target.name,
            "size": file_size,
            "mime_type": mime,
            "editable": False,
        }
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"[API] Read file failed: {e}")
        return {"error": str(e)}


@app.put("/api/files/save")
async def save_file_content(body: dict):
    """Save text content to a file (for the file viewer editor)."""
    try:
        rel_path = body.get("path", "").strip()
        content = body.get("content")

        if not rel_path:
            return {"error": "Path is required"}
        if content is None:
            return {"error": "Content is required"}

        target = _safe_resolve(rel_path)

        # Only allow saving text files
        if not _is_text_file(target) and target.exists():
            return {"error": "Only text files can be saved via this endpoint"}

        # Ensure parent directory exists
        target.parent.mkdir(parents=True, exist_ok=True)

        target.write_text(content, encoding="utf-8")
        return {
            "success": True,
            "path": rel_path,
            "size": len(content.encode("utf-8")),
        }
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"[API] Save file failed: {e}")
        return {"error": str(e)}


@app.delete("/api/files")
async def delete_file(body: dict):
    """Delete a file or directory within the working dir."""
    try:
        rel_path = body.get("path", "").strip()
        if not rel_path:
            return {"error": "Path is required"}
        target = _safe_resolve(rel_path)
        if not target.exists():
            return {"error": "Path does not exist"}

        # Prevent deleting the working dir itself
        working = Path(WORKING_DIR).resolve()
        if target == working:
            return {"error": "Cannot delete the working directory root"}

        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()

        return {"deleted": True, "path": rel_path}
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"[API] Delete failed: {e}")
        return {"error": str(e)}


@app.get("/api/files/tree")
async def file_tree():
    """Return a flat list of all files in the working dir for @-mention autocomplete."""
    try:
        working = Path(WORKING_DIR).resolve()
        files = []
        for p in working.rglob("*"):
            if p.is_file() and not any(
                part.startswith(".") for part in p.relative_to(working).parts
            ):
                rel = str(p.relative_to(working))
                parent = str(p.relative_to(working).parent)
                files.append({
                    "path": rel,
                    "name": p.name,
                    "folder": parent if parent != "." else "",
                })
        files.sort(key=lambda f: f["path"].lower())
        return {"files": files}
    except Exception as e:
        logger.error(f"[API] File tree failed: {e}")
        return {"files": [], "error": str(e)}


@app.websocket("/ws/chat")
async def chat_websocket(ws: WebSocket):
    await ws.accept()
    _connected_clients.add(ws)

    # Check for session_id query param to resume an existing session
    resume_session_id = ws.query_params.get("session_id")

    manager = ClydeChatManager(working_dir=WORKING_DIR, ws=ws)
    session_id: str | None = None
    is_first_user_message = True

    # Queue for incoming WebSocket messages that arrive during send_message
    # This solves the deadlock: permission_response messages must be processed
    # concurrently while send_message is iterating.
    ws_incoming: asyncio.Queue[dict] = asyncio.Queue()
    ws_reader_task: asyncio.Task | None = None

    # Reference to the active streaming task so it can be cancelled
    response_task: asyncio.Task | None = None

    async def _ws_reader():
        """Continuously read from WebSocket and enqueue messages."""
        try:
            while True:
                raw = await ws.receive_text()
                data = json.loads(raw)
                await ws_incoming.put(data)
        except WebSocketDisconnect:
            await ws_incoming.put({"type": "__disconnect__"})
        except Exception as e:
            logger.error(f"[WS] Reader error: {e}")
            await ws_incoming.put({"type": "__error__", "error": str(e)})

    async def _handle_incoming(data: dict):
        """Process a single incoming WebSocket message."""
        nonlocal response_task

        if data.get("type") == "cancel_request":
            logger.info("[WS] Cancel request received — aborting response")
            # Cancel the streaming task if running — the main loop handles cleanup
            if response_task and not response_task.done():
                response_task.cancel()
            return

        if data.get("type") == "permission_response":
            perm_id = data.get("id", "")
            decision = data.get("decision", "deny")
            logger.info(f"[WS] Permission response: id={perm_id}, decision={decision}")
            await manager.handle_permission_response(perm_id, decision)

            # Log the decision to Supabase
            if session_id:
                try:
                    await save_permission_decision(
                        session_id=session_id,
                        agent_id=data.get("agent_id"),
                        agent_name=data.get("agent_name"),
                        tool_name=data.get("tool_name", "unknown"),
                        tool_input=data.get("tool_input", {}),
                        decision=decision,
                    )
                except Exception:
                    pass

    async def _drain_incoming():
        """Process all queued incoming messages (non-blocking)."""
        while not ws_incoming.empty():
            try:
                data = ws_incoming.get_nowait()
                await _handle_incoming(data)
            except asyncio.QueueEmpty:
                break

    async def _process_incoming_during_response():
        """
        Continuously process incoming messages while send_message is running.
        This allows permission_response messages to be handled without deadlock.
        """
        while True:
            try:
                data = await asyncio.wait_for(ws_incoming.get(), timeout=0.1)
                if data.get("type") in ("__disconnect__", "__error__"):
                    return
                await _handle_incoming(data)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                return

    try:
        # Determine session: resume existing or defer creation until first message
        prior_messages: list[dict] = []
        stored_sdk_session_id: str | None = None
        if resume_session_id:
            session_id = resume_session_id
            logger.info(f"[WS] Resuming session: {session_id}")
            prior_messages = await get_session_messages(session_id)
            is_first_user_message = len(prior_messages) == 0
            # Load the SDK session ID for native CLI resumption
            session_record = await get_session(session_id)
            if session_record:
                stored_sdk_session_id = (
                    (session_record.get("metadata") or {}).get("sdk_session_id")
                )
                if stored_sdk_session_id:
                    logger.info(
                        f"[WS] Found SDK session ID: {stored_sdk_session_id} "
                        "— will resume CLI session natively"
                    )
        else:
            # Defer session creation — don't persist until the user sends a message
            session_id = None
            logger.info("[WS] New chat — session creation deferred until first message")

        # Initialize the Agent SDK client.
        # If we have an SDK session ID, the CLI resumes its persisted session
        # (with built-in auto-compaction). Otherwise, fall back to manual
        # context summary from prior_messages.
        await manager.initialize(
            prior_messages=prior_messages if not stored_sdk_session_id else None,
            sdk_session_id=stored_sdk_session_id,
        )

        # Notify frontend of session (session_id is null for deferred new chats)
        await ws.send_json({"type": "init", "data": {"session_id": session_id}})

        # If resuming, send prior messages to frontend for display
        if prior_messages:
            await ws.send_json({
                "type": "session_history",
                "data": {
                    "messages": [
                        {
                            "id": m["id"],
                            "session_id": m["session_id"],
                            "role": m["role"],
                            "agent_name": m.get("agent_name"),
                            "content": m["content"],
                            "cost_usd": m.get("cost_usd", 0),
                            "metadata": m.get("metadata", {}),
                            "created_at": m["created_at"],
                        }
                        for m in prior_messages
                    ]
                },
            })

        # Send persisted activity events for the session
        if session_id:
            try:
                activity_events = await get_activity_events(session_id)
                if activity_events:
                    await ws.send_json({
                        "type": "activity_history",
                        "data": {
                            "events": [
                                {
                                    "id": e["id"],
                                    "agent_id": e["agent_id"],
                                    "agent_name": e["agent_name"],
                                    "event_type": e["event_type"],
                                    "description": e.get("description", ""),
                                    "metadata": e.get("metadata", {}),
                                    "created_at": e["created_at"],
                                }
                                for e in activity_events
                            ]
                        },
                    })
            except Exception as e:
                logger.error(f"[WS] Failed to load activity events: {e}")

        # Start the background WebSocket reader
        ws_reader_task = asyncio.create_task(_ws_reader())

        while True:
            # Wait for the next incoming message
            data = await ws_incoming.get()

            if data.get("type") in ("__disconnect__", "__error__"):
                break

            if data.get("type") == "user_message":
                user_content = data["content"]

                # Build context from referenced files (@-mentions and uploads)
                file_refs = data.get("file_refs", [])
                agent_content = user_content
                if file_refs:
                    file_context_parts = []
                    image_refs = []  # Images handled separately via Read tool
                    max_file_size = 1_000_000  # 1MB limit per file
                    _IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"}

                    for ref_path in file_refs:
                        try:
                            target = _safe_resolve(ref_path)
                            if not target.is_file():
                                file_context_parts.append(
                                    f"--- @{ref_path} ---\n[File not found]\n--- End of @{ref_path} ---"
                                )
                                continue
                            file_size = target.stat().st_size
                            ext = target.suffix.lower()

                            # Images: don't inline binary data — tell Claude to
                            # use its Read tool which handles images natively
                            if ext in _IMAGE_EXTENSIONS:
                                size_kb = round(file_size / 1024)
                                image_refs.append(ref_path)
                                file_context_parts.append(
                                    f"--- @{ref_path} ---\n"
                                    f"[Image file ({ext}, {size_kb}KB). "
                                    f"Use the Read tool on the absolute path to view this image: "
                                    f"{target}]\n"
                                    f"--- End of @{ref_path} ---"
                                )
                                continue

                            if file_size > max_file_size:
                                size_mb = round(file_size / 1_000_000, 1)
                                file_context_parts.append(
                                    f"--- @{ref_path} ---\n[File too large to inline: {size_mb}MB. The file exists at {ref_path} in the working directory.]\n--- End of @{ref_path} ---"
                                )
                                continue
                            # Try reading as text
                            try:
                                text = target.read_text(encoding="utf-8")
                                file_context_parts.append(
                                    f"--- Contents of @{ref_path} ---\n{text}\n--- End of @{ref_path} ---"
                                )
                            except (UnicodeDecodeError, ValueError):
                                # Binary file — don't inline, just reference
                                file_context_parts.append(
                                    f"--- @{ref_path} ---\n[Binary file ({ext}) — {round(file_size/1024)}KB. "
                                    f"Cannot display inline. The file exists at {target} "
                                    f"and can be accessed via the Read tool.]\n--- End of @{ref_path} ---"
                                )
                        except Exception as e:
                            logger.warning(f"[WS] Failed to read referenced file {ref_path}: {e}")
                            file_context_parts.append(
                                f"--- @{ref_path} ---\n[Error reading file: {e}]\n--- End of @{ref_path} ---"
                            )
                    if file_context_parts:
                        agent_content = "\n\n".join(file_context_parts) + "\n\n" + user_content

                # Build context from folder reference (FileBrowser "Start Chat")
                folder_context = data.get("folder_context")
                if folder_context is not None:
                    try:
                        folder_target = (
                            _safe_resolve(folder_context)
                            if folder_context
                            else Path(WORKING_DIR).resolve()
                        )
                        if folder_target.is_dir():
                            folder_items = []
                            for entry in sorted(
                                folder_target.iterdir(),
                                key=lambda e: (not e.is_dir(), e.name.lower()),
                            ):
                                if entry.name.startswith("."):
                                    continue
                                if entry.is_dir():
                                    folder_items.append(f"  [dir] {entry.name}")
                                else:
                                    size_bytes = entry.stat().st_size
                                    if size_bytes < 1024:
                                        size_str = f"{size_bytes} B"
                                    elif size_bytes < 1024 * 1024:
                                        size_str = f"{round(size_bytes / 1024, 1)} KB"
                                    else:
                                        size_str = f"{round(size_bytes / (1024 * 1024), 1)} MB"
                                    folder_items.append(f"  [file] {entry.name} ({size_str})")

                            display_path = f"working/{folder_context}" if folder_context else "working/"
                            items_listing = "\n".join(folder_items) if folder_items else "  (empty directory)"
                            folder_listing = (
                                f"--- Folder context: {display_path} ---\n"
                                f"The user is currently browsing this folder. Contents:\n"
                                f"{items_listing}\n"
                                f"--- End of folder context ---"
                            )
                            agent_content = folder_listing + "\n\n" + agent_content
                            logger.info(f"[WS] Folder context added: {display_path} ({len(folder_items)} items)")
                        else:
                            logger.warning(f"[WS] folder_context path is not a directory: {folder_context}")
                    except ValueError as e:
                        logger.warning(f"[WS] folder_context path traversal blocked: {e}")
                    except Exception as e:
                        logger.warning(f"[WS] Failed to resolve folder_context: {e}")

                # Lazy session creation: persist on first message only
                if session_id is None:
                    session = await create_session("New Chat")
                    session_id = session["id"]
                    is_first_user_message = True
                    logger.info(f"[WS] Created session on first message: {session_id}")
                    # Notify frontend of the real session_id + add to sidebar
                    await ws.send_json({
                        "type": "session_created",
                        "data": {
                            "session_id": session_id,
                            "title": "New Chat",
                            "created_at": session.get("created_at", ""),
                        },
                    })

                # Save user message to Supabase with embedding (fire concurrently — don't block agent)
                async def _save_user_message():
                    try:
                        user_embedding = await generate_embedding(user_content)
                    except Exception:
                        user_embedding = None
                    await save_message(
                        session_id=session_id,
                        role="user",
                        content=user_content,
                        embedding=user_embedding,
                    )

                asyncio.create_task(_save_user_message())

                # Start a concurrent task to process incoming messages
                # (permission responses, cancel requests) while streaming.
                incoming_processor = asyncio.create_task(
                    _process_incoming_during_response()
                )

                # Stream Clyde's response in a cancellable task
                full_response = ""
                result_data: dict = {}
                was_cancelled = False

                async def _stream_response():
                    nonlocal full_response, result_data
                    ws_dead = False
                    async for chunk in manager.send_message(agent_content):
                        if not ws_dead:
                            try:
                                await ws.send_json(chunk)
                            except Exception:
                                # Client disconnected mid-stream. Keep consuming
                                # the SDK iterator so we can still save the full
                                # response and result data.
                                ws_dead = True
                                logger.warning(
                                    "[WS] Client disconnected during streaming "
                                    "— continuing to drain SDK response for persistence"
                                )

                        # Accumulate all final text blocks for storage
                        if (
                            chunk["type"] == "assistant_text"
                            and chunk["data"].get("final")
                        ):
                            if full_response:
                                full_response += "\n\n" + chunk["data"]["text"]
                            else:
                                full_response = chunk["data"]["text"]

                        if chunk["type"] == "result":
                            result_data = chunk["data"]

                    if ws_dead:
                        raise WebSocketDisconnect()

                response_task = asyncio.create_task(_stream_response())
                ws_disconnected = False

                try:
                    await response_task
                except asyncio.CancelledError:
                    was_cancelled = True
                    logger.info("[WS] Response streaming was cancelled by user")
                    # Abort the SDK client to kill in-flight API calls
                    try:
                        await manager.abort()
                    except Exception as e:
                        logger.error(f"[WS] Error during abort: {e}")
                except WebSocketDisconnect:
                    ws_disconnected = True
                    logger.info(
                        "[WS] Client disconnected during response — "
                        "saving partial response and exiting"
                    )
                except Exception as e:
                    error_str = str(e).lower()
                    is_prompt_too_long = (
                        "prompt is too long" in error_str
                        or "prompt_too_long" in error_str
                        or "context_length_exceeded" in error_str
                    )
                    if is_prompt_too_long and session_id:
                        logger.warning(
                            "[WS] Prompt too long — attempting context roll and retry"
                        )
                        try:
                            roll_messages = await get_session_messages(session_id)
                            await manager.context_roll(prior_messages=roll_messages)
                            # Retry the same user message with the rolled context
                            full_response = ""
                            result_data = {}
                            response_task = asyncio.create_task(_stream_response())
                            retry_incoming = asyncio.create_task(
                                _process_incoming_during_response()
                            )
                            try:
                                await response_task
                            except Exception as retry_err:
                                logger.error(
                                    f"[WS] Retry after context roll also failed: {retry_err}"
                                )
                            finally:
                                response_task = None
                                retry_incoming.cancel()
                                try:
                                    await retry_incoming
                                except asyncio.CancelledError:
                                    pass
                        except Exception as roll_err:
                            logger.error(
                                f"[WS] Context roll during recovery failed: {roll_err}"
                            )
                    else:
                        logger.error(f"[WS] Error during streaming: {e}")
                finally:
                    response_task = None
                    # Stop the incoming processor once response is done
                    incoming_processor.cancel()
                    try:
                        await incoming_processor
                    except asyncio.CancelledError:
                        pass

                # Process any remaining queued messages
                if not ws_disconnected:
                    await _drain_incoming()

                if was_cancelled:
                    # Re-initialize the manager so it's ready for the next message
                    try:
                        await manager.initialize()
                        logger.info("[WS] Manager re-initialized after cancel")
                    except Exception as e:
                        logger.error(f"[WS] Failed to re-initialize after cancel: {e}")
                    # Notify frontend
                    try:
                        await ws.send_json({
                            "type": "cancel_confirmed",
                            "data": {"message": "Response cancelled"},
                        })
                    except Exception:
                        pass
                    continue  # Skip post-response processing, go back to waiting

                # Save Clyde's response + log performance concurrently (fire-and-forget)
                async def _save_clyde_response():
                    if not full_response:
                        return
                    try:
                        clyde_embedding = await generate_embedding(full_response)
                    except Exception:
                        clyde_embedding = None

                    # Include accumulated steps in metadata for persistence
                    msg_metadata: dict = {"model": "claude-opus-4-6"}
                    if manager._response_steps:
                        msg_metadata["steps"] = manager._response_steps

                    await save_message(
                        session_id=session_id,
                        role="clyde",
                        content=full_response,
                        embedding=clyde_embedding,
                        agent_name="Clyde",
                        cost_usd=result_data.get("total_cost_usd", 0),
                        metadata=msg_metadata,
                    )

                async def _log_performance():
                    if not (_performance_logger and result_data):
                        return
                    try:
                        _performance_logger.log_event(
                            session_id=session_id,
                            agent_name="Clyde",
                            task_type="direct",
                            description=user_content[:200],
                            completion_time_ms=result_data.get("duration_ms", 0),
                            total_cost_usd=result_data.get("total_cost_usd", 0),
                            model="opus",
                            is_error=result_data.get("is_error", False),
                            num_turns=result_data.get("num_turns", 0),
                        )
                    except Exception as e:
                        logger.error(f"[WS] Performance log failed: {e}")

                    # Log delegated subagent work so they appear as active
                    # in the performance stats (prevents false "inactive" insights)
                    try:
                        delegated_agents: set[str] = set()
                        for step in manager._response_steps:
                            if step.get("type") == "agent_stopped":
                                agent_label = step.get("label", "")
                                if agent_label and agent_label.lower() != "clyde":
                                    delegated_agents.add(agent_label)

                        for agent_name in delegated_agents:
                            _performance_logger.log_event(
                                session_id=session_id,
                                agent_name=agent_name,
                                task_type="delegated",
                                description=f"Delegated by Clyde: {user_content[:150]}",
                                completion_time_ms=0,
                                total_cost_usd=0,
                                model="sonnet",
                                is_error=result_data.get("is_error", False),
                            )
                    except Exception as e:
                        logger.error(f"[WS] Subagent perf log failed: {e}")

                async def _cleanup_uploads():
                    """Delete uploaded files after processing if save_uploads_enabled is off."""
                    if not file_refs:
                        return
                    try:
                        s = load_settings(WORKING_DIR)
                        if s.get("save_uploads_enabled", True):
                            return  # Saving is on — keep files
                        for ref_path in file_refs:
                            if ref_path.startswith("uploads/"):
                                try:
                                    target = _safe_resolve(ref_path)
                                    if target.is_file():
                                        target.unlink()
                                        logger.info(f"[WS] Cleaned up upload: {ref_path}")
                                except Exception as e:
                                    logger.warning(f"[WS] Failed to clean up {ref_path}: {e}")
                    except Exception as e:
                        logger.warning(f"[WS] Upload cleanup check failed: {e}")

                async def _store_sdk_session_id():
                    """Persist the CLI's session ID so future reconnects can
                    resume natively instead of building a manual context summary."""
                    sdk_sid = manager._sdk_session_id
                    if sdk_sid and session_id:
                        try:
                            await update_session_sdk_id(session_id, sdk_sid)
                        except Exception as e:
                            logger.warning(f"[WS] Failed to store SDK session ID: {e}")

                async def _post_response_work():
                    await asyncio.gather(
                        _save_clyde_response(),
                        _log_performance(),
                        _cleanup_uploads(),
                        _store_sdk_session_id(),
                        return_exceptions=True,
                    )

                if ws_disconnected:
                    # Client gone — await the save so it completes before
                    # the handler exits and the manager is torn down.
                    await _post_response_work()
                    break

                asyncio.create_task(_post_response_work())

                # Auto-title the session after the first user message
                if is_first_user_message and session_id:
                    is_first_user_message = False
                    try:
                        # Simple heuristic: truncate first user message
                        auto_title = user_content[:40].strip()
                        if len(user_content) > 40:
                            auto_title += "..."
                        await update_session_title(session_id, auto_title)
                        await ws.send_json({
                            "type": "session_title_update",
                            "data": {
                                "session_id": session_id,
                                "title": auto_title,
                            },
                        })
                    except Exception:
                        pass

                # After each turn, send registry update so frontend
                # can refresh the agent list (org chart, activity panel)
                try:
                    registry = load_registry(WORKING_DIR)
                    agents = registry.get("agents", [])
                    await ws.send_json({
                        "type": "registry_update",
                        "data": {
                            "agent_count": len(agents),
                            "agents": [
                                {
                                    "id": a["id"],
                                    "name": a["name"],
                                    "role": a["role"],
                                    "model": a.get("model", "sonnet"),
                                    "avatar": a.get("avatar"),
                                    "status": a.get("status", "active"),
                                    "tools": a.get("tools", []),
                                    "skills": a.get("skills", []),
                                }
                                for a in agents
                            ],
                        },
                    })
                except Exception:
                    pass

            else:
                # Handle any other message types (including permission_response
                # that arrives outside of send_message — e.g. late responses)
                await _handle_incoming(data)

    except WebSocketDisconnect:
        logger.info("[WS] Client disconnected")
    except Exception as e:
        logger.error(f"[WS] Error in chat websocket: {e}", exc_info=True)
        try:
            await ws.send_json({"type": "error", "data": {"message": str(e)}})
        except Exception:
            pass
    finally:
        _connected_clients.discard(ws)
        if ws_reader_task and not ws_reader_task.done():
            ws_reader_task.cancel()
            try:
                await ws_reader_task
            except asyncio.CancelledError:
                pass
        await manager.disconnect()


@app.get("/api/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    messages = await get_session_messages(session_id)
    return {"messages": messages}
