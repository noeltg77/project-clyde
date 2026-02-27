"""
ClydeChatManager — Manages a persistent multi-turn chat session with Clyde
via the Claude Agent SDK, including subagent delegation, permission handling,
and activity hooks.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import WebSocket

logger = logging.getLogger(__name__)

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AgentDefinition,
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
)
from claude_agent_sdk.types import (
    StreamEvent,
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
    HookMatcher,
)

from services.registry import load_registry
from services.supabase_client import save_activity_event
from agents.tools import registry_mcp_server, init_tools

# All MCP tool names that Clyde should auto-allow (no permission popup needed)
_AUTO_ALLOW_TOOLS = {
    # Phase 2: Agent registry
    "create_agent", "list_agents", "update_agent", "get_agent_details",
    # Phase 3: Search, Memory, Skills
    "search_history",
    "read_agent_memory", "update_agent_memory",
    "create_skill", "list_skills", "read_skill", "update_skill", "assign_skill",
    # Phase 4: Schedules, Triggers, MCP
    "create_schedule", "list_schedules", "delete_schedule", "pause_schedule",
    "create_trigger", "list_triggers", "delete_trigger",
    "assign_mcp_server",
    # Phase 5: Self-Improvement
    "review_agent_performance", "improve_agent_prompt",
    "analyse_team_gaps", "log_performance",
    # Phase 6: Proactive Insights
    "get_insights", "trigger_analysis",
}


class ClydeChatManager:
    """Manages a persistent multi-turn chat session with Clyde via the Claude Agent SDK."""

    def __init__(self, working_dir: str, ws: WebSocket | None = None):
        self.working_dir = working_dir
        self.ws = ws
        self.client: ClaudeSDKClient | None = None
        self.session_id: str | None = None

        # Permission handling state
        self.pending_permissions: dict[str, asyncio.Event] = {}
        self.permission_responses: dict[str, str] = {}

        # "Allow all similar" cache — tool names that have been blanket-approved
        self._allowed_tools: set[str] = set()

        # Agent teams — concurrency tracking (Phase 4A)
        self._active_agent_count: int = 0

        # Steps accumulated during the current response (tool_use, agent activity)
        self._response_steps: list[dict[str, Any]] = []

        # Prompt caching: volatile context (timestamp + context summary) is held
        # here and prepended to the first user message instead of being baked
        # into the system prompt, keeping the system prompt cache-friendly.
        self._volatile_context: str = ""
        self._volatile_context_sent: bool = False

        # Initialise MCP tools with working directory
        init_tools(working_dir)

    def _load_system_prompt(self) -> str:
        prompt_path = os.path.join(self.working_dir, "prompts", "clyde-system.md")
        with open(prompt_path, "r") as f:
            prompt = f.read()

        # Inject the actual working directory path so Clyde knows where to save files
        abs_working = str(Path(self.working_dir).resolve())
        prompt += (
            "\n\n## Working Directory\n\n"
            f"Your working directory is: `{abs_working}`\n\n"
            "All file operations (Read, Write, Edit, Glob, Grep) MUST use paths within "
            "this directory. Use this absolute path when saving files — for example:\n"
            f"- `{abs_working}/outputs/report.md`\n"
            f"- `{abs_working}/uploads/data.csv`\n"
            f"- `{abs_working}/exports/post.md`\n\n"
            "Create subdirectories as needed (e.g. `outputs/`, `exports/`). "
            "Never use `~/`, `/Users/`, `/home/`, or any path outside this directory.\n"
        )

        # Check if prompt caching is enabled
        try:
            registry = load_registry(self.working_dir)
            caching_enabled = registry.get("prompt_caching_enabled", True)
        except Exception:
            registry = {}
            caching_enabled = True

        # Current local time — either injected into system prompt (no caching)
        # or held in volatile context for the first user message (caching on)
        local_now = datetime.now()
        time_context = (
            f"[Current local date and time: {local_now.strftime('%A, %d %B %Y at %I:%M %p')}]\n\n"
        )

        if caching_enabled:
            # Move timestamp to volatile context → prepended to first user message
            self._volatile_context = time_context
        else:
            # Original behaviour: bake timestamp into system prompt
            prompt += (
                "\n\n## Current Time\n\n"
                f"The current local date and time is: **{local_now.strftime('%A, %d %B %Y at %I:%M %p')}**\n"
            )

        # Inject any skills assigned to the orchestrator (Clyde)
        try:
            if not registry:
                registry = load_registry(self.working_dir)
            orchestrator = registry.get("orchestrator", {})
            skill_names = orchestrator.get("skills", [])
            if skill_names:
                skills_content = self._load_agent_skills(skill_names)
                if skills_content:
                    prompt += (
                        "\n\n## Your Assigned Skills\n\n"
                        "The following skills have been assigned to you. Follow these "
                        "documented processes when relevant to your tasks.\n\n"
                        f"{skills_content}"
                    )
        except Exception:
            pass  # Non-critical — continue without skills if registry read fails

        return prompt

    def _build_context_summary(self, messages: list[dict]) -> str:
        """Build a conversation transcript from prior messages for session resumption.

        Uses a token budget approach: the most recent messages get full content
        while older messages are progressively truncated to fit within limits.
        """
        if not messages:
            return ""

        # Token budget (~40k chars ≈ ~10k tokens) — enough for rich context
        # without bloating the system prompt beyond reason.
        MAX_CHARS = 40_000

        # Work backwards from most recent messages — they matter most.
        # Last 2 messages (typically the most recent user+clyde exchange) get
        # full content. Earlier messages get truncated progressively.
        lines: list[str] = []
        total_chars = 0

        for i, m in enumerate(reversed(messages)):
            role = m.get("role", "unknown")
            name = m.get("agent_name") or role.capitalize()
            content = (m.get("content") or "").strip()

            if i < 2:
                # Most recent exchange: full content
                truncated = content
            elif i < 10:
                # Recent messages: generous truncation
                truncated = content[:2000]
                if len(content) > 2000:
                    truncated += " [...]"
            else:
                # Older messages: tighter truncation
                truncated = content[:800]
                if len(content) > 800:
                    truncated += " [...]"

            line = f"**{name}:** {truncated}"

            if total_chars + len(line) > MAX_CHARS:
                # Budget exhausted — note how many messages we're skipping
                skipped = len(messages) - len(lines)
                if skipped > 0:
                    lines.append(f"*[{skipped} earlier messages omitted]*")
                break

            lines.append(line)
            total_chars += len(line)

        # Reverse back to chronological order
        lines.reverse()
        transcript = "\n\n".join(lines)

        return (
            "\n\n## Resumed Conversation\n\n"
            "This session was interrupted and is now being resumed. The full "
            "conversation transcript from this session is reproduced below. "
            "You MUST treat this as your own prior conversation — continue "
            "naturally from where you left off. Do NOT say things like "
            "\"I don't have context\" or \"let me search for what we discussed\". "
            "You already know what was discussed because it is right here:\n\n"
            f"{transcript}\n\n"
            "---\n"
            "The conversation continues from this point. Respond as if "
            "there was no interruption."
        )

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

    def _load_agent_skills(self, skill_names: list[str]) -> str:
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

    def _build_agent_definitions(self) -> dict[str, AgentDefinition]:
        """Load active agents from registry and build SDK AgentDefinition objects.

        Injects agent memory and assigned skills into each agent's system prompt.
        """
        try:
            registry = load_registry(self.working_dir)
        except Exception:
            return {}

        agents: dict[str, AgentDefinition] = {}
        for agent in registry.get("agents", []):
            if agent.get("status") == "active":
                prompt = self._load_agent_prompt(agent.get("system_prompt_path", ""))

                # Inject accumulated memory (Phase 3C)
                memory_content = self._load_agent_memory(agent.get("memory_path", ""))
                if memory_content:
                    prompt += (
                        "\n\n## Your Memory (Accumulated Knowledge)\n\n"
                        "The following is your accumulated knowledge from previous tasks. "
                        "Use this context to inform your current work.\n\n"
                        f"{memory_content}"
                    )

                # Inject assigned skills (Phase 3D)
                skills_content = self._load_agent_skills(agent.get("skills", []))
                if skills_content:
                    prompt += (
                        "\n\n## Assigned Skills\n\n"
                        "The following skills have been assigned to you. Follow these "
                        "documented processes when relevant to your tasks.\n\n"
                        f"{skills_content}"
                    )

                # NOTE: External MCP servers from registry are tracked but not passed
                # to AgentDefinition — the SDK does not support mcp_servers at the
                # agent definition level. MCP servers are wired at the top-level
                # ClaudeAgentOptions instead.

                # Inject file boundary rule into every subagent's prompt
                abs_working = str(Path(self.working_dir).resolve())
                prompt += (
                    "\n\n## File Access Rules\n\n"
                    "**CRITICAL**: You may ONLY read, write, and create files within "
                    f"the working directory: `{abs_working}`\n\n"
                    "- ALL file paths MUST be within this directory. Use absolute paths like:\n"
                    f"  - `{abs_working}/outputs/filename.md`\n"
                    f"  - `{abs_working}/uploads/data.csv`\n"
                    "- NEVER use paths starting with `~/`, `/Users/`, `/home/`, `/tmp/`, "
                    "or any path outside the working directory.\n"
                    "- NEVER use `..` to traverse above the working directory.\n"
                    "- If you need to save output, create a subdirectory within the working "
                    "directory (e.g. `outputs/`, `exports/`).\n"
                )

                agents[agent["name"].lower()] = AgentDefinition(
                    description=agent.get("role", "Specialist agent"),
                    prompt=prompt,
                    tools=agent.get("tools"),
                    model=agent.get("model", "sonnet"),
                )
        return agents

    def _is_within_working_dir(self, file_path: str) -> bool:
        """Check if a file path resolves within the working directory."""
        try:
            working = Path(self.working_dir).resolve()
            target = Path(file_path).resolve()
            return str(target).startswith(str(working))
        except Exception:
            return False

    # File tools that should be auto-allowed when operating within the working directory
    _FILE_TOOLS = {"Read", "Write", "Edit", "Glob", "Grep"}

    async def _handle_permission(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        context: ToolPermissionContext,
    ) -> PermissionResultAllow | PermissionResultDeny:
        """
        Intercepts permission requests from the SDK and relays them to the
        frontend via WebSocket. Waits for the user's response before returning.

        In headless mode (ws=None, e.g. scheduled tasks), all tools are
        auto-allowed since there is no user to prompt.
        """
        logger.info(f"[PERMISSION] tool_name={tool_name!r}, input_keys={list(tool_input.keys())}")

        # Headless mode (scheduler, self-improvement) — auto-allow everything
        # since there is no frontend to prompt for permission
        if self.ws is None:
            logger.info(f"[PERMISSION] Headless mode — auto-allowing {tool_name}")
            return PermissionResultAllow()

        # Auto-allow all Clyde MCP tools — check both bare and prefixed names
        bare_name = tool_name.split("__")[-1] if "__" in tool_name else tool_name
        if tool_name in _AUTO_ALLOW_TOOLS or bare_name in _AUTO_ALLOW_TOOLS:
            logger.info(f"[PERMISSION] Auto-allowing MCP tool: {tool_name}")
            return PermissionResultAllow()

        # Auto-allow file tools (Read, Write, Edit, Glob, Grep) when the target
        # path is within the working directory — no permission popup needed
        if tool_name in self._FILE_TOOLS:
            target_path = (
                tool_input.get("file_path")
                or tool_input.get("path")
                or tool_input.get("pattern")
                or ""
            )
            if target_path and self._is_within_working_dir(target_path):
                logger.info(f"[PERMISSION] Auto-allowing {tool_name} within working dir: {target_path}")
                return PermissionResultAllow()
            # If path is outside working dir, DENY immediately — don't even prompt
            if target_path and not self._is_within_working_dir(target_path):
                logger.warning(f"[PERMISSION] DENIED {tool_name} outside working dir: {target_path}")
                return PermissionResultDeny(
                    message=f"Path '{target_path}' is outside the working directory. "
                    f"All file operations must stay within {self.working_dir}"
                )

        # Check "allow all similar" cache
        if tool_name in self._allowed_tools:
            return PermissionResultAllow()

        perm_id = str(uuid.uuid4())
        event = asyncio.Event()
        self.pending_permissions[perm_id] = event

        # Push permission request to frontend
        try:
            await self.ws.send_json({
                "type": "permission_request",
                "data": {
                    "id": perm_id,
                    "tool_name": tool_name,
                    "tool_input": {
                        k: str(v)[:200] for k, v in tool_input.items()
                    },
                    "agent_name": "Clyde",
                    "model_tier": "opus",
                },
            })
        except Exception:
            self.pending_permissions.pop(perm_id, None)
            return PermissionResultDeny(message="Could not reach frontend for permission")

        # Wait for user response with 60s timeout
        try:
            await asyncio.wait_for(event.wait(), timeout=60.0)
            decision = self.permission_responses.pop(perm_id, "deny")
        except asyncio.TimeoutError:
            decision = "deny"
            try:
                await self.ws.send_json({
                    "type": "permission_timeout",
                    "data": {"id": perm_id},
                })
            except Exception:
                pass
        finally:
            self.pending_permissions.pop(perm_id, None)

        if decision == "allow":
            return PermissionResultAllow()
        elif decision == "allow_all_similar":
            self._allowed_tools.add(tool_name)
            return PermissionResultAllow()
        else:
            return PermissionResultDeny(message="User denied permission")

    async def handle_permission_response(self, perm_id: str, decision: str) -> None:
        """Called by the WebSocket handler when the user responds to a permission popup."""
        self.permission_responses[perm_id] = decision
        event = self.pending_permissions.get(perm_id)
        if event:
            event.set()

    async def _on_subagent_start(self, hook_input: dict, tool_use_id: str | None, context: Any) -> dict:
        """Hook: push agent activity event to frontend when a subagent starts."""
        self._active_agent_count += 1
        parent_agent = hook_input.get("parent_agent_id", "")
        is_team_member = bool(parent_agent)

        # Log concurrency warning if approaching cap
        try:
            registry = load_registry(self.working_dir)
            cap = registry.get("concurrency_cap", 5)
            if self._active_agent_count > cap:
                logger.warning(
                    f"[CONCURRENCY] Active agents ({self._active_agent_count}) "
                    f"exceeds concurrency cap ({cap})"
                )
        except Exception:
            pass

        # Track as a response step
        agent_type = hook_input.get("agent_type", "")
        self._response_steps.append({
            "type": "agent_started",
            "label": agent_type or hook_input.get("agent_id", "unknown"),
            "detail": "Team member" if is_team_member else "Subagent",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        agent_id = hook_input.get("agent_id", "")
        agent_label = agent_type or agent_id
        description = "Team member started" if is_team_member else "Agent started"

        if self.ws:
            try:
                await self.ws.send_json({
                    "type": "agent_activity",
                    "data": {
                        "event": "started",
                        "agent_id": agent_id,
                        "agent_type": agent_type,
                        "parent_agent": parent_agent,
                        "is_team_member": is_team_member,
                    },
                })
            except Exception:
                pass

        # Persist to Supabase
        try:
            await save_activity_event(
                session_id=self.session_id,
                agent_id=agent_id,
                agent_name=agent_label,
                event_type="started",
                description=description,
                metadata={"parent_agent": parent_agent, "is_team_member": is_team_member},
            )
        except Exception:
            pass
        return {"continue_": True}

    async def _on_subagent_stop(self, hook_input: dict, tool_use_id: str | None, context: Any) -> dict:
        """Hook: push agent activity event to frontend when a subagent stops."""
        self._active_agent_count = max(0, self._active_agent_count - 1)
        parent_agent = hook_input.get("parent_agent_id", "")
        is_team_member = bool(parent_agent)

        # Track as a response step
        agent_type = hook_input.get("agent_type", "")
        self._response_steps.append({
            "type": "agent_stopped",
            "label": agent_type or hook_input.get("agent_id", "unknown"),
            "detail": "Team member" if is_team_member else "Subagent",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        agent_id = hook_input.get("agent_id", "")
        agent_label = agent_type or agent_id
        description = "Team member stopped" if is_team_member else "Agent stopped"

        if self.ws:
            try:
                await self.ws.send_json({
                    "type": "agent_activity",
                    "data": {
                        "event": "stopped",
                        "agent_id": agent_id,
                        "agent_type": agent_type,
                        "parent_agent": parent_agent,
                        "is_team_member": is_team_member,
                    },
                })
            except Exception:
                pass

        # Persist to Supabase
        try:
            await save_activity_event(
                session_id=self.session_id,
                agent_id=agent_id,
                agent_name=agent_label,
                event_type="stopped",
                description=description,
                metadata={"parent_agent": parent_agent, "is_team_member": is_team_member},
            )
        except Exception:
            pass
        return {"continue_": True}

    async def _on_notification(self, hook_input: dict, tool_use_id: str | None, context: Any) -> dict:
        """Hook: forward SDK notifications to the frontend."""
        if self.ws:
            try:
                await self.ws.send_json({
                    "type": "agent_notification",
                    "data": {
                        "message": hook_input.get("message", ""),
                        "title": hook_input.get("title", ""),
                        "notification_type": hook_input.get("notification_type", ""),
                    },
                })
            except Exception:
                pass
        return {"continue_": True}

    async def initialize(self, prior_messages: list[dict] | None = None):
        """Create and connect the ClaudeSDKClient with subagent support."""
        # Reset volatile context state for fresh init (e.g. after cancel/reconnect)
        self._volatile_context = ""
        self._volatile_context_sent = False

        system_prompt = self._load_system_prompt()

        # Check caching preference (already loaded in _load_system_prompt but
        # we need the flag here too for context summary handling)
        try:
            registry = load_registry(self.working_dir)
            caching_enabled = registry.get("prompt_caching_enabled", True)
        except Exception:
            caching_enabled = True

        # Inject prior conversation context when resuming a session
        if prior_messages:
            context_summary = self._build_context_summary(prior_messages)
            if caching_enabled:
                # Move context summary to volatile context → prepended to first user message
                # This keeps the system prompt stable for cache hits across sessions
                self._volatile_context += context_summary
                logger.info(
                    f"[INIT] Context summary ({len(prior_messages)} messages) "
                    "moved to volatile context for prompt caching"
                )
            else:
                # Original behaviour: append to system prompt
                system_prompt += context_summary
                logger.info(f"[INIT] Injected context summary ({len(prior_messages)} messages)")

        logger.info(f"[INIT] Prompt caching: {'enabled' if caching_enabled else 'disabled'}")

        agents = self._build_agent_definitions()
        logger.info(f"[INIT] System prompt length: {len(system_prompt)}")
        logger.info(f"[INIT] Agents from registry: {list(agents.keys()) if agents else 'none'}")
        logger.info(f"[INIT] MCP server config: {registry_mcp_server.get('type')}/{registry_mcp_server.get('name')}")

        # Build full allowed_tools list with both bare and prefixed forms
        bare_tools = list(_AUTO_ALLOW_TOOLS)
        prefixed_tools = [f"mcp__registry_tools__{t}" for t in _AUTO_ALLOW_TOOLS]

        # Collect all tools that subagents need so they're whitelisted at top level
        subagent_tools: set[str] = set()
        for agent_def in agents.values():
            if agent_def.tools:
                subagent_tools.update(agent_def.tools)

        # Headless mode (scheduler, self-improvement): bypass all permissions at
        # the CLI level so the subprocess never blocks waiting for user input.
        # Interactive mode: use our callback that relays to the frontend.
        is_headless = self.ws is None
        if is_headless:
            logger.info("[INIT] Headless mode — using bypassPermissions")

        options = ClaudeAgentOptions(
            model="claude-opus-4-6",
            system_prompt=system_prompt,
            allowed_tools=[
                # Standard file/code tools
                "Read", "Edit", "Write", "Bash", "Glob", "Grep",
                # Web tools (needed by research-type subagents)
                "WebSearch", "WebFetch",
                # Subagent delegation
                "Task",
                # Any additional tools declared on subagents in the registry
                *[t for t in subagent_tools if t not in {
                    "Read", "Edit", "Write", "Bash", "Glob", "Grep",
                    "WebSearch", "WebFetch", "Task",
                }],
                # Custom MCP tools — bare names
                *bare_tools,
                # Also include prefixed forms in case CLI uses mcp__<server>__<tool> format
                *prefixed_tools,
            ],
            agents=agents if agents else None,
            mcp_servers={"registry_tools": registry_mcp_server},
            permission_mode="bypassPermissions" if is_headless else "default",
            can_use_tool=None if is_headless else self._handle_permission,
            hooks={
                "SubagentStart": [HookMatcher(hooks=[self._on_subagent_start])],
                "SubagentStop": [HookMatcher(hooks=[self._on_subagent_stop])],
                "Notification": [HookMatcher(hooks=[self._on_notification])],
            },
            cwd=self.working_dir,
            # Restrict all file operations to the working directory only
            add_dirs=[self.working_dir],
            include_partial_messages=True,
            # Phase 4A: Enable agent teams — subagents can spawn their own sub-teams
            env={"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"},
        )

        self.client = ClaudeSDKClient(options=options)
        logger.info("[INIT] Connecting ClaudeSDKClient...")
        try:
            await self.client.connect()
            logger.info("[INIT] ClaudeSDKClient connected successfully")
        except Exception as e:
            logger.error(f"[INIT] ClaudeSDKClient connection failed: {e}", exc_info=True)
            raise

    async def send_message(self, content: str):
        """Send a user message and yield response chunks for streaming."""
        if not self.client:
            raise RuntimeError("Client not initialized. Call initialize() first.")

        # Reset steps for this response
        self._response_steps = []

        # Prompt caching: prepend volatile context (timestamp, context summary)
        # to the first user message only, keeping the system prompt cache-stable
        if self._volatile_context and not self._volatile_context_sent:
            content = self._volatile_context + content
            self._volatile_context_sent = True
            logger.info("[MSG] Prepended volatile context to first user message")

        logger.info(f"[MSG] Sending user message: {content[:100]}...")
        await self.client.query(content)

        async for message in self.client.receive_response():
            logger.debug(f"[MSG] Received: {type(message).__name__}")
            if isinstance(message, StreamEvent):
                # Token-level streaming events
                event = message.event
                if isinstance(event, dict) and event.get("type") == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        yield {
                            "type": "assistant_text",
                            "data": {"text": delta["text"], "streaming": True},
                        }

            elif isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        yield {
                            "type": "assistant_text",
                            "data": {"text": block.text, "final": True},
                        }
                    elif isinstance(block, ToolUseBlock):
                        # Track as a step
                        self._response_steps.append({
                            "type": "tool_use",
                            "label": block.name,
                            "detail": str(block.input)[:200],
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })
                        yield {
                            "type": "tool_use",
                            "data": {
                                "tool": block.name,
                                "input": str(block.input)[:500],
                            },
                        }

            elif isinstance(message, ResultMessage):
                self.session_id = getattr(message, "session_id", None)
                yield {
                    "type": "result",
                    "data": {
                        "session_id": self.session_id,
                        "total_cost_usd": getattr(message, "total_cost_usd", 0),
                        "duration_ms": getattr(message, "duration_ms", 0),
                        "num_turns": getattr(message, "num_turns", 0),
                        "is_error": getattr(message, "is_error", False),
                    },
                }

    async def abort(self) -> None:
        """Abort any in-progress response by disconnecting the SDK client.

        The caller is responsible for re-initializing afterwards if needed.
        """
        logger.info("[ABORT] Aborting current response — disconnecting SDK client")
        if self.client:
            try:
                await self.client.disconnect()
            except Exception as e:
                logger.warning(f"[ABORT] Error during disconnect: {e}")
            self.client = None

    async def refresh_agents(self) -> None:
        """
        Reload agent definitions from registry. Call after a new agent
        is created mid-session to make them available for delegation.
        """
        if self.client:
            await self.client.disconnect()
        await self.initialize()

    async def disconnect(self):
        """Clean up the client connection."""
        if self.client:
            await self.client.disconnect()
            self.client = None
