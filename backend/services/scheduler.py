"""
TaskScheduler — Manages scheduled tasks using APScheduler.

Supports two schedule types:
  - "recurring"  — Cron-based repeating schedules (CronTrigger)
  - "one_off"    — Run-once at a specific datetime (DateTrigger)

Schedules are persisted to working/schedules.json.
When a schedule fires, it creates a new headless chat session and sends
the prompt to Clyde for autonomous execution.
"""

import asyncio
import json
import logging
import os
import random
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger

logger = logging.getLogger(__name__)


class TaskScheduler:
    """Cron-based task scheduler that triggers headless Clyde sessions."""

    def __init__(self, working_dir: str):
        self.working_dir = working_dir
        self.scheduler = AsyncIOScheduler()
        self._schedules: list[dict] = []
        self._schedules_path = os.path.join(working_dir, "schedules.json")
        self._load_schedules()

    # ─── Persistence ──────────────────────────────────────────

    def _load_schedules(self) -> None:
        """Load schedules from JSON file."""
        if os.path.exists(self._schedules_path):
            try:
                with open(self._schedules_path, "r") as f:
                    data = json.load(f)
                self._schedules = data.get("schedules", [])
                logger.info(f"[SCHEDULER] Loaded {len(self._schedules)} schedules")
            except Exception as e:
                logger.error(f"[SCHEDULER] Failed to load schedules: {e}")
                self._schedules = []
        else:
            self._schedules = []

    def _save_schedules(self) -> None:
        """Persist schedules to JSON file."""
        os.makedirs(os.path.dirname(self._schedules_path), exist_ok=True)
        with open(self._schedules_path, "w") as f:
            json.dump({"schedules": self._schedules}, f, indent=2, default=str)

    # ─── CRUD ─────────────────────────────────────────────────

    async def add_schedule(
        self,
        name: str,
        prompt: str,
        agent_name: str | None = None,
        schedule_type: str = "recurring",
        cron: str | None = None,
        run_at: str | None = None,
    ) -> dict:
        """Create a new scheduled task (recurring or one-off)."""
        schedule_id = f"sch-{random.randint(100000000000, 999999999999)}"
        now = datetime.now(timezone.utc).isoformat()

        schedule = {
            "id": schedule_id,
            "name": name,
            "schedule_type": schedule_type,
            "cron": cron,
            "run_at": run_at,
            "prompt": prompt,
            "agent_name": agent_name,
            "enabled": True,
            "created_at": now,
            "last_run": None,
            "run_count": 0,
        }

        self._schedules.append(schedule)
        self._save_schedules()

        # Register with APScheduler
        self._register_job(schedule)

        label = cron if schedule_type == "recurring" else f"once at {run_at}"
        logger.info(f"[SCHEDULER] Created schedule: {name} ({label})")
        return schedule

    async def remove_schedule(self, schedule_id: str) -> bool:
        """Remove a scheduled task."""
        self._schedules = [s for s in self._schedules if s["id"] != schedule_id]
        self._save_schedules()

        # Remove from APScheduler
        try:
            self.scheduler.remove_job(schedule_id)
        except Exception:
            pass

        logger.info(f"[SCHEDULER] Removed schedule: {schedule_id}")
        return True

    async def list_schedules(self) -> list[dict]:
        """List all schedules."""
        return self._schedules

    async def pause_schedule(self, schedule_id: str) -> bool:
        """Pause/resume a schedule by toggling enabled."""
        for s in self._schedules:
            if s["id"] == schedule_id:
                s["enabled"] = not s["enabled"]
                self._save_schedules()

                if s["enabled"]:
                    self._register_job(s)
                    logger.info(f"[SCHEDULER] Resumed: {s['name']}")
                else:
                    try:
                        self.scheduler.remove_job(schedule_id)
                    except Exception:
                        pass
                    logger.info(f"[SCHEDULER] Paused: {s['name']}")
                return True
        return False

    async def update_schedule(
        self,
        schedule_id: str,
        updates: dict,
    ) -> dict | None:
        """Update a schedule's configuration."""
        for s in self._schedules:
            if s["id"] == schedule_id:
                for k, v in updates.items():
                    if k in ("name", "cron", "run_at", "schedule_type", "prompt", "agent_name", "enabled"):
                        s[k] = v
                self._save_schedules()

                # Re-register job if cron or enabled changed
                try:
                    self.scheduler.remove_job(schedule_id)
                except Exception:
                    pass
                if s.get("enabled", True):
                    self._register_job(s)

                return s
        return None

    # ─── Agent Helpers (mirrors ClydeChatManager logic) ──────

    def _load_agent_prompt(self, prompt_rel_path: str) -> str:
        """Load an agent's system prompt from its relative path."""
        abs_path = os.path.join(
            self.working_dir,
            prompt_rel_path.replace("/working/", "", 1),
        )
        if os.path.exists(abs_path):
            with open(abs_path, "r") as f:
                return f.read()
        return f"System prompt not found at {prompt_rel_path}"

    def _load_agent_memory(self, memory_rel_path: str) -> str:
        """Load an agent's memory file content."""
        if not memory_rel_path:
            return ""
        abs_path = os.path.join(
            self.working_dir,
            memory_rel_path.replace("/working/", "", 1),
        )
        if os.path.exists(abs_path):
            with open(abs_path, "r") as f:
                content = f.read().strip()
            if content:
                return content
        return ""

    def _load_skills(self, skill_names: list[str]) -> str:
        """Load all assigned skill documents for an agent."""
        if not skill_names:
            return ""
        skills_dir = os.path.join(self.working_dir, "skills")
        sections = []
        for skill_name in skill_names:
            filename = f"{skill_name}.md" if not skill_name.endswith(".md") else skill_name
            filepath = os.path.join(skills_dir, filename)
            if os.path.exists(filepath):
                with open(filepath, "r") as f:
                    content = f.read().strip()
                if content:
                    sections.append(f"### {skill_name}\n\n{content}")
        return "\n\n".join(sections) if sections else ""

    def _build_agent_definitions(self) -> dict:
        """Load active agents from registry and build SDK AgentDefinition objects.

        Injects agent memory and assigned skills into each agent's system prompt.
        """
        from pathlib import Path
        from claude_agent_sdk import AgentDefinition
        from services.registry import load_registry

        try:
            registry = load_registry(self.working_dir)
        except Exception:
            return {}

        agents: dict[str, AgentDefinition] = {}
        for agent in registry.get("agents", []):
            if agent.get("status") == "active":
                prompt = self._load_agent_prompt(agent.get("system_prompt_path", ""))

                # Inject accumulated memory
                memory_content = self._load_agent_memory(agent.get("memory_path", ""))
                if memory_content:
                    prompt += (
                        "\n\n## Your Memory (Accumulated Knowledge)\n\n"
                        "The following is your accumulated knowledge from previous tasks. "
                        "Use this context to inform your current work.\n\n"
                        f"{memory_content}"
                    )

                # Inject assigned skills
                skills_content = self._load_skills(agent.get("skills", []))
                if skills_content:
                    prompt += (
                        "\n\n## Assigned Skills\n\n"
                        "The following skills have been assigned to you. Follow these "
                        "documented processes when relevant to your tasks.\n\n"
                        f"{skills_content}"
                    )

                # Inject file boundary rule
                abs_working = str(Path(self.working_dir).resolve())
                prompt += (
                    "\n\n## File Access Rules\n\n"
                    "**CRITICAL**: You may ONLY read, write, and create files within "
                    f"the working directory: `{abs_working}`\n\n"
                    "- ALL file paths MUST be within this directory.\n"
                    "- NEVER use paths starting with `~/`, `/Users/`, `/home/`, `/tmp/`, "
                    "or any path outside the working directory.\n"
                )

                agents[agent["name"].lower()] = AgentDefinition(
                    description=agent.get("role", "Specialist agent"),
                    prompt=prompt,
                    tools=agent.get("tools"),
                    model=agent.get("model", "sonnet"),
                )

        return agents

    # ─── Job Registration ─────────────────────────────────────

    def _register_job(self, schedule: dict) -> None:
        """Register a schedule with APScheduler (CronTrigger or DateTrigger)."""
        if not schedule.get("enabled", True):
            return

        schedule_type = schedule.get("schedule_type", "recurring")

        try:
            if schedule_type == "one_off":
                run_at_str = schedule.get("run_at")
                if not run_at_str:
                    logger.error(f"[SCHEDULER] one_off schedule '{schedule['name']}' has no run_at")
                    return
                # Normalise Z → +00:00 for Python < 3.11 compat
                run_date = datetime.fromisoformat(run_at_str.replace("Z", "+00:00"))
                trigger = DateTrigger(run_date=run_date)
            else:
                trigger = CronTrigger.from_crontab(schedule["cron"])

            self.scheduler.add_job(
                self._execute_scheduled_task,
                trigger=trigger,
                args=[schedule],
                id=schedule["id"],
                replace_existing=True,
                name=schedule["name"],
            )
        except Exception as e:
            logger.error(f"[SCHEDULER] Failed to register job {schedule['name']}: {e}")

    async def _execute_scheduled_task(self, schedule: dict) -> None:
        """Execute a scheduled task using ClaudeSDKClient.

        Uses a dedicated ClaudeSDKClient per execution with bypassPermissions
        and no hooks (headless). If the stream dies mid-execution, the partial
        response is saved rather than lost.
        """
        from pathlib import Path

        from claude_agent_sdk import (
            ClaudeSDKClient,
            ClaudeAgentOptions,
            AssistantMessage,
            ResultMessage,
            TextBlock,
        )
        from services.supabase_client import create_session, save_message
        from services.embeddings import generate_embedding
        from services.registry import load_registry
        from agents.tools import registry_mcp_server, init_tools

        schedule_name = schedule["name"]
        prompt = schedule["prompt"]
        logger.info(f"[SCHEDULER] Executing: {schedule_name}")

        client: ClaudeSDKClient | None = None
        session_id: str | None = None
        full_response = ""
        result_data: dict = {}
        chunk_count = 0
        stream_error = False

        try:
            # Create a new chat session in Supabase
            session_title = f"[Scheduled] {schedule_name}"
            session = await create_session(session_title)
            session_id = session["id"]

            # Notify connected frontends immediately
            from main import broadcast_session_created
            await broadcast_session_created(session)

            # Save user message
            try:
                user_embedding = await generate_embedding(prompt)
            except Exception:
                user_embedding = None

            await save_message(
                session_id=session_id,
                role="user",
                content=prompt,
                embedding=user_embedding,
                agent_name="[Scheduler]",
            )

            # Load Clyde's system prompt
            prompt_path = os.path.join(self.working_dir, "prompts", "clyde-system.md")
            with open(prompt_path, "r") as f:
                system_prompt = f.read()

            abs_working = str(Path(self.working_dir).resolve())
            system_prompt += (
                "\n\n## Working Directory\n\n"
                f"Your working directory is: `{abs_working}`\n\n"
                "All file operations (Read, Write, Edit, Glob, Grep) MUST use paths within "
                "this directory.\n"
            )

            # Inject orchestrator skills into system prompt
            try:
                registry = load_registry(self.working_dir)
                orchestrator = registry.get("orchestrator", {})
                skill_names = orchestrator.get("skills", [])
                if skill_names:
                    skills_content = self._load_skills(skill_names)
                    if skills_content:
                        system_prompt += (
                            "\n\n## Your Assigned Skills\n\n"
                            "The following skills have been assigned to you. Follow these "
                            "documented processes when relevant to your tasks.\n\n"
                            f"{skills_content}"
                        )
            except Exception:
                pass

            # Initialise MCP tools
            init_tools(self.working_dir)

            # Build agent definitions from registry (subagent delegation)
            agents = self._build_agent_definitions()
            logger.info(f"[SCHEDULER] Agents from registry: {list(agents.keys()) if agents else 'none'}")

            # Build allowed_tools list
            from agents.clyde import _AUTO_ALLOW_TOOLS
            bare_tools = list(_AUTO_ALLOW_TOOLS)
            prefixed_tools = [f"mcp__registry_tools__{t}" for t in _AUTO_ALLOW_TOOLS]

            # Collect tools declared on subagents so they're whitelisted at top level
            subagent_tools: set[str] = set()
            for agent_def in agents.values():
                if agent_def.tools:
                    subagent_tools.update(agent_def.tools)

            options = ClaudeAgentOptions(
                model="claude-opus-4-6",
                system_prompt=system_prompt,
                allowed_tools=[
                    "Read", "Edit", "Write", "Bash", "Glob", "Grep",
                    "WebSearch", "WebFetch", "Task",
                    *[t for t in subagent_tools if t not in {
                        "Read", "Edit", "Write", "Bash", "Glob", "Grep",
                        "WebSearch", "WebFetch", "Task",
                    }],
                    *bare_tools,
                    *prefixed_tools,
                ],
                agents=agents if agents else None,
                mcp_servers={"registry_tools": registry_mcp_server},
                permission_mode="bypassPermissions",
                can_use_tool=None,
                cwd=self.working_dir,
                add_dirs=[self.working_dir],
                env={"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"},
            )

            # Create and connect a dedicated client for this execution
            client = ClaudeSDKClient(options=options)
            logger.info("[SCHEDULER] Connecting ClaudeSDKClient...")
            await client.connect()
            logger.info("[SCHEDULER] Connected — sending query")
            await client.query(prompt)

            # Collect response with timeout + stream error resilience
            timed_out = False
            timeout_seconds = 600  # 10 minutes

            async def _collect_response():
                nonlocal full_response, result_data, chunk_count, stream_error
                try:
                    async for message in client.receive_response():
                        chunk_count += 1
                        if isinstance(message, AssistantMessage):
                            for block in message.content:
                                if isinstance(block, TextBlock):
                                    logger.info(
                                        f"[SCHEDULER] Chunk #{chunk_count}: text len={len(block.text)} "
                                        f"preview={block.text[:80]!r}"
                                    )
                                    if full_response:
                                        full_response += "\n\n" + block.text
                                    else:
                                        full_response = block.text
                        elif isinstance(message, ResultMessage):
                            result_data = {
                                "total_cost_usd": getattr(message, "total_cost_usd", 0),
                                "duration_ms": getattr(message, "duration_ms", 0),
                                "num_turns": getattr(message, "num_turns", 0),
                                "is_error": getattr(message, "is_error", False),
                            }
                            logger.info(
                                f"[SCHEDULER] Result: cost=${result_data['total_cost_usd']:.4f}, "
                                f"turns={result_data['num_turns']}, error={result_data['is_error']}"
                            )
                        else:
                            # StreamEvent or other — log first few
                            if chunk_count <= 3:
                                logger.info(f"[SCHEDULER] Chunk #{chunk_count}: {type(message).__name__}")
                except (BaseExceptionGroup, ExceptionGroup) as eg:
                    # SDK TaskGroup errors (stream closed, transport died)
                    stream_error = True
                    logger.warning(
                        f"[SCHEDULER] Stream error after {chunk_count} chunks "
                        f"({len(full_response)} chars captured): {eg}"
                    )
                except Exception as e:
                    stream_error = True
                    logger.warning(
                        f"[SCHEDULER] Stream error after {chunk_count} chunks "
                        f"({len(full_response)} chars captured): {e}"
                    )

            try:
                await asyncio.wait_for(_collect_response(), timeout=timeout_seconds)
            except asyncio.TimeoutError:
                timed_out = True
                logger.error(
                    f"[SCHEDULER] TIMEOUT after {timeout_seconds}s for '{schedule_name}' "
                    f"({chunk_count} chunks, {len(full_response)} chars so far)"
                )

            logger.info(
                f"[SCHEDULER] Collected {chunk_count} chunks, "
                f"response length: {len(full_response)} chars"
            )

            # Save whatever response we have (even partial from timeout or stream error)
            if full_response:
                if timed_out:
                    full_response += (
                        "\n\n---\n*This scheduled task timed out after "
                        f"{timeout_seconds // 60} minutes. The response above may be partial.*"
                    )
                elif stream_error:
                    full_response += (
                        "\n\n---\n*The connection to the AI was interrupted. "
                        "The response above may be partial.*"
                    )
                try:
                    clyde_embedding = await generate_embedding(full_response[:8000])
                except Exception:
                    clyde_embedding = None

                await save_message(
                    session_id=session_id,
                    role="clyde",
                    content=full_response,
                    embedding=clyde_embedding,
                    agent_name="Clyde",
                    cost_usd=result_data.get("total_cost_usd", 0),
                    metadata={
                        "model": "claude-opus-4-6",
                        "scheduled": True,
                        "timed_out": timed_out,
                        "stream_error": stream_error,
                    },
                )
            else:
                logger.warning(
                    f"[SCHEDULER] No response text captured for '{schedule_name}' "
                    f"after {chunk_count} chunks. Possible SDK error."
                )

            # Update schedule metadata
            schedule["last_run"] = datetime.now(timezone.utc).isoformat()
            schedule["run_count"] = schedule.get("run_count", 0) + 1

            # Auto-disable one-off schedules after they fire
            if schedule.get("schedule_type") == "one_off":
                schedule["enabled"] = False

            self._save_schedules()

            logger.info(
                f"[SCHEDULER] Completed: {schedule_name} "
                f"(session: {session_id}, cost: ${result_data.get('total_cost_usd', 0):.4f})"
            )

        except Exception as e:
            logger.error(f"[SCHEDULER] Failed to execute {schedule_name}: {e}", exc_info=True)

            # Even on hard failure, try to save partial response if we have one
            if full_response and session_id:
                try:
                    from services.supabase_client import save_message as _save_msg
                    from services.embeddings import generate_embedding as _gen_emb
                    try:
                        emb = await _gen_emb(full_response[:8000])
                    except Exception:
                        emb = None
                    await _save_msg(
                        session_id=session_id,
                        role="clyde",
                        content=full_response + "\n\n---\n*Task execution failed. Response may be partial.*",
                        embedding=emb,
                        agent_name="Clyde",
                        metadata={"scheduled": True, "error": str(e)[:500]},
                    )
                except Exception:
                    pass

        finally:
            # Always clean up the client connection
            if client:
                try:
                    await client.disconnect()
                except Exception:
                    pass

    # ─── Lifecycle ────────────────────────────────────────────

    def start(self) -> None:
        """Start the scheduler and register all enabled jobs."""
        for schedule in self._schedules:
            if schedule.get("enabled", True):
                self._register_job(schedule)

        self.scheduler.start()
        logger.info(
            f"[SCHEDULER] Started with {len(self._schedules)} schedule(s)"
        )

    def stop(self) -> None:
        """Shut down the scheduler."""
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("[SCHEDULER] Stopped")
