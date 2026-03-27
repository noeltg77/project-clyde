"""
DeepAgentChatManager — LangChain Deep Agents + OpenRouter alternative to ClydeChatManager.

This module provides a chat manager that uses LangChain's Deep Agents framework
with OpenRouter as the model provider, while sharing the same tool infrastructure,
system prompts, and WebSocket event format as the Anthropic SDK path.

Usage:
    When settings.json has agent_provider="openrouter", main.py instantiates this
    class instead of ClydeChatManager. The WebSocket handler treats both identically.
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import WebSocket
from langchain_openrouter import ChatOpenRouter
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langgraph.checkpoint.memory import MemorySaver
from deepagents import create_deep_agent

from agents.tools import init_tools, update_session_context
from agents.tool_adapter import get_langchain_tools
from services.settings import load_settings, OPENROUTER_POPULAR_MODELS
from services.registry import load_registry

logger = logging.getLogger("clyde.deep_agent")


class DeepAgentChatManager:
    """Chat manager powered by LangChain Deep Agents and OpenRouter.

    Mirrors ClydeChatManager's interface so the WebSocket handler in main.py
    can use either interchangeably based on the agent_provider setting.
    """

    def __init__(self, working_dir: str, ws: WebSocket | None = None):
        self.working_dir = working_dir
        self.ws = ws
        self.agent = None
        self.session_id: str | None = None
        self.supabase_session_id: str | None = None

        # Permission handling state (mirrors ClydeChatManager)
        self.pending_permissions: dict[str, asyncio.Event] = {}
        self.permission_responses: dict[str, str] = {}

        # Cost tracking
        self._total_cost: float = 0.0
        self._prev_session_cost: float = 0.0

        # Steps accumulated during current response
        self._response_steps: list[dict[str, Any]] = []

        # Volatile context (same pattern as ClydeChatManager)
        self._volatile_context: str = ""
        self._volatile_context_sent: bool = False

        # Debug state
        self._last_system_prompt: str = ""
        self._last_user_message: str = ""

        # Active stream task for abort support
        self._active_stream: asyncio.Task | None = None

        # LangGraph checkpointer for session persistence
        self._checkpointer = MemorySaver()

        # Thread ID for LangGraph (maps to our session concept)
        self._thread_id: str = ""

        # Initialise MCP tools with working directory
        init_tools(working_dir)

    def _load_system_prompt(self) -> str:
        """Load the system prompt — same logic as ClydeChatManager.

        Loads clyde-system.md and builds volatile context (working dir, timestamp,
        skills) to be prepended to the first user message.
        """
        prompt_path = os.path.join(self.working_dir, "prompts", "clyde-system.md")
        with open(prompt_path, "r") as f:
            prompt = f.read()

        # Build volatile context
        volatile_parts: list[str] = []

        # Working directory info
        abs_working = str(Path(self.working_dir).resolve())
        volatile_parts.append(
            f"## Working Directory\n\n"
            f"Your working directory is: `{abs_working}`\n\n"
            "All file operations (Read, Write, Edit, Glob, Grep) MUST use paths within "
            "this directory. Use this absolute path when saving files — for example:\n"
            f"- `{abs_working}/outputs/report.md`\n"
            f"- `{abs_working}/uploads/data.csv`\n"
            f"- `{abs_working}/exports/post.md`\n\n"
            "Create subdirectories as needed (e.g. `outputs/`, `exports/`). "
            "Never use `~/`, `/Users/`, `/home/`, or any path outside this directory.\n"
        )

        # Current local time
        local_now = datetime.now()
        volatile_parts.append(
            f"[Current local date and time: {local_now.strftime('%A, %d %B %Y at %I:%M %p')}]\n"
        )

        # Orchestrator skills
        try:
            registry = load_registry(self.working_dir)
            orchestrator = registry.get("orchestrator", {})
            skill_names = orchestrator.get("skills", [])
            if skill_names:
                skill_summaries = self._load_skill_summaries(skill_names)
                if skill_summaries:
                    volatile_parts.append(
                        "## Your Assigned Skills\n\n"
                        "You have the following skills available. When a task matches "
                        "a skill's description, use the `read_skill` tool to load the "
                        "full skill content before proceeding.\n\n"
                        f"{skill_summaries}\n\n"
                        "**Do not guess skill procedures from memory.** Always call "
                        '`read_skill(name="<skill-name>")` to load the complete '
                        "instructions before applying a skill."
                    )
        except Exception:
            pass

        self._volatile_context = "\n\n".join(volatile_parts)
        return prompt

    def _load_skill_summaries(self, skill_names: list[str]) -> str:
        """Load one-line summaries for assigned skills."""
        summaries = []
        skills_dir = os.path.join(self.working_dir, "skills")
        for name in skill_names:
            skill_path = os.path.join(skills_dir, f"{name}.md")
            if os.path.exists(skill_path):
                try:
                    with open(skill_path, "r") as f:
                        first_line = f.readline().strip()
                    # Use the first non-empty line as the summary
                    if first_line.startswith("#"):
                        first_line = first_line.lstrip("# ").strip()
                    summaries.append(f"- **{name}**: {first_line}")
                except Exception:
                    summaries.append(f"- **{name}**")
            else:
                summaries.append(f"- **{name}**")
        return "\n".join(summaries)

    def _build_context_summary(self, messages: list[dict]) -> str:
        """Build a conversation transcript from prior messages."""
        if not messages:
            return ""

        # Token budget (~40k chars ≈ ~10k tokens)
        max_chars = 40_000
        parts: list[str] = []
        total_chars = 0

        parts.append(
            "\n\n## Previous Conversation Context\n\n"
            "Below is the recent conversation history for context continuity:\n\n"
        )

        # Process newest first, then reverse for chronological order
        message_parts: list[str] = []
        for msg in reversed(messages):
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if not content:
                continue

            label = "User" if role == "user" else "Clyde"
            part = f"**{label}:** {content}\n\n"

            if total_chars + len(part) > max_chars:
                # Truncate this message to fit remaining budget
                remaining = max_chars - total_chars
                if remaining > 100:
                    part = f"**{label}:** {content[:remaining - 50]}... [truncated]\n\n"
                    message_parts.append(part)
                break

            message_parts.append(part)
            total_chars += len(part)

        # Reverse for chronological order
        message_parts.reverse()
        parts.extend(message_parts)
        parts.append("---\n\n")

        return "".join(parts)

    async def initialize(
        self,
        prior_messages: list[dict] | None = None,
        sdk_session_id: str | None = None,
    ):
        """Create and configure the Deep Agent with OpenRouter.

        Args:
            prior_messages: Chat history from Supabase for context summary.
            sdk_session_id: Ignored for Deep Agents (used by Anthropic SDK only).
                Kept for interface compatibility.
        """
        self._volatile_context = ""
        self._volatile_context_sent = False

        system_prompt = self._load_system_prompt()
        self._last_system_prompt = system_prompt

        # Build context summary from prior messages if available
        if prior_messages:
            context_summary = self._build_context_summary(prior_messages)
            self._volatile_context += context_summary
            logger.info(
                f"[DEEP_INIT] Context summary ({len(prior_messages)} messages) "
                "added to volatile context"
            )

        # Load settings for model selection
        settings = load_settings(self.working_dir)
        model_id = settings.get("openrouter_model", "anthropic/claude-sonnet-4")

        # Create the OpenRouter chat model
        api_key = os.environ.get("OPENROUTER_API_KEY", "")
        if not api_key:
            raise RuntimeError(
                "OPENROUTER_API_KEY is not set. Add it to .env.local or switch "
                "agent_provider to 'anthropic' in settings."
            )

        chat_model = ChatOpenRouter(
            model=model_id,
            api_key=api_key,
            streaming=True,
            temperature=0.7,
        )

        # Get all tools adapted for LangChain
        langchain_tools = get_langchain_tools()
        logger.info(f"[DEEP_INIT] Adapted {len(langchain_tools)} tools for LangChain")

        # Generate a thread ID for LangGraph session persistence
        if not self._thread_id:
            self._thread_id = sdk_session_id or f"deep-{int(time.time())}"

        # Create the Deep Agent
        self.agent = create_deep_agent(
            model=chat_model,
            tools=langchain_tools,
            system_prompt=system_prompt,
            checkpointer=self._checkpointer,
        )

        logger.info(
            f"[DEEP_INIT] Deep Agent initialized — model={model_id}, "
            f"tools={len(langchain_tools)}, thread={self._thread_id}"
        )

    async def send_message(self, content: str):
        """Send a user message and yield response chunks for streaming.

        Translates LangGraph streaming events into the same WebSocket event
        format that ClydeChatManager produces, so the WebSocket handler and
        frontend work identically.
        """
        if not self.agent:
            raise RuntimeError("Agent not initialized. Call initialize() first.")

        self._response_steps = []
        start_time = time.monotonic()

        # Prepend volatile context to first message (same as ClydeChatManager)
        if self._volatile_context and not self._volatile_context_sent:
            content = self._volatile_context + content
            self._volatile_context_sent = True
            logger.info("[DEEP_MSG] Prepended volatile context to first user message")

        self._last_user_message = content
        logger.info(f"[DEEP_MSG] Sending message: {content[:100]}...")

        # Get the model tier for frontend display
        settings = load_settings(self.working_dir)
        model_id = settings.get("openrouter_model", "anthropic/claude-sonnet-4")

        config = {
            "configurable": {
                "thread_id": self._thread_id,
            }
        }

        accumulated_text = ""
        message_cost = 0.0
        num_tool_calls = 0

        try:
            async for event in self.agent.astream_events(
                {"messages": [HumanMessage(content=content)]},
                config=config,
                version="v2",
            ):
                kind = event.get("event", "")

                # Streaming text tokens
                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if isinstance(chunk, AIMessageChunk) and chunk.content:
                        text = chunk.content if isinstance(chunk.content, str) else ""
                        if text:
                            accumulated_text += text
                            yield {
                                "type": "assistant_text",
                                "data": {
                                    "text": text,
                                    "streaming": True,
                                    "model_tier": model_id,
                                },
                            }

                # Tool call started
                elif kind == "on_tool_start":
                    tool_name = event.get("name", "unknown")
                    tool_input = event.get("data", {}).get("input", {})
                    num_tool_calls += 1

                    self._response_steps.append({
                        "type": "tool_use",
                        "label": tool_name,
                        "detail": str(tool_input)[:200],
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })

                    yield {
                        "type": "tool_use",
                        "data": {
                            "tool": tool_name,
                            "input": str(tool_input)[:500],
                        },
                    }

                # Chat model end — extract cost metadata
                elif kind == "on_chat_model_end":
                    output = event.get("data", {}).get("output")
                    if isinstance(output, AIMessage):
                        # Extract cost from OpenRouter response metadata
                        meta = getattr(output, "response_metadata", {}) or {}
                        usage = meta.get("usage", {})
                        # OpenRouter includes total_cost in some responses
                        if "total_cost" in meta:
                            message_cost += float(meta["total_cost"])
                        elif usage:
                            # Estimate from token counts (rough fallback)
                            prompt_tokens = usage.get("prompt_tokens", 0)
                            completion_tokens = usage.get("completion_tokens", 0)
                            # Use a rough average rate — OpenRouter returns actual
                            # cost in most responses, this is just a fallback
                            message_cost += (prompt_tokens * 0.003 + completion_tokens * 0.015) / 1000

        except asyncio.CancelledError:
            logger.info("[DEEP_MSG] Stream cancelled (abort)")
            return
        except Exception as e:
            logger.error(f"[DEEP_MSG] Error during streaming: {e}", exc_info=True)
            yield {
                "type": "assistant_text",
                "data": {
                    "text": f"\n\n[Error: {str(e)}]",
                    "final": True,
                    "model_tier": model_id,
                },
            }
            yield {
                "type": "result",
                "data": {
                    "session_id": self._thread_id,
                    "total_cost_usd": message_cost,
                    "duration_ms": int((time.monotonic() - start_time) * 1000),
                    "num_turns": num_tool_calls,
                    "is_error": True,
                },
            }
            return

        # Send final text marker if we accumulated any text
        if accumulated_text:
            yield {
                "type": "assistant_text",
                "data": {
                    "text": accumulated_text,
                    "final": True,
                    "model_tier": model_id,
                },
            }

        # Track cumulative cost
        self._total_cost += message_cost
        incremental_cost = message_cost

        elapsed_ms = int((time.monotonic() - start_time) * 1000)

        yield {
            "type": "result",
            "data": {
                "session_id": self._thread_id,
                "total_cost_usd": incremental_cost,
                "duration_ms": elapsed_ms,
                "num_turns": num_tool_calls,
                "is_error": False,
            },
        }

        logger.info(
            f"[DEEP_MSG] Response complete — cost=${message_cost:.4f}, "
            f"tools={num_tool_calls}, elapsed={elapsed_ms}ms"
        )

    async def handle_permission_response(self, perm_id: str, decision: str) -> None:
        """Handle permission response from frontend.

        For Deep Agents, permission handling is done via LangGraph's interrupt
        mechanism. This stores the decision so the graph can resume.
        """
        self.permission_responses[perm_id] = decision
        event = self.pending_permissions.get(perm_id)
        if event:
            event.set()

    async def abort(self) -> None:
        """Abort any in-progress response."""
        logger.info("[DEEP_ABORT] Aborting current response")
        if self._active_stream and not self._active_stream.done():
            self._active_stream.cancel()

    async def context_roll(self, prior_messages: list[dict] | None = None) -> None:
        """Roll the context by reinitializing the agent.

        Creates a new thread ID so LangGraph starts fresh, with the context
        summary from prior_messages providing continuity.
        """
        logger.info("[DEEP_CONTEXT_ROLL] Rolling context")
        # New thread = fresh LangGraph state
        self._thread_id = f"deep-{int(time.time())}"
        await self.initialize(prior_messages=prior_messages)
        logger.info("[DEEP_CONTEXT_ROLL] Context roll complete")

    async def refresh_agents(self) -> None:
        """Reload agent definitions — reinitializes with fresh tools."""
        await self.initialize()

    async def disconnect(self) -> None:
        """Clean up resources."""
        logger.info("[DEEP_DISCONNECT] Disconnecting")
        self.agent = None
