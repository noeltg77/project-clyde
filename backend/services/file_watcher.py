"""
FileWatcherService — Monitors directories for file changes and triggers
headless Clyde sessions when matching files are detected.

Triggers are persisted to working/triggers.json.
Uses watchfiles (Rust-backed, async-native) for efficient file monitoring.
"""

import asyncio
import fnmatch
import json
import logging
import os
import random
from datetime import datetime, timezone
from pathlib import Path

import watchfiles

logger = logging.getLogger(__name__)


class FileWatcherService:
    """Watches directories for file changes and triggers Clyde tasks."""

    def __init__(self, working_dir: str):
        self.working_dir = working_dir
        self._triggers: list[dict] = []
        self._triggers_path = os.path.join(working_dir, "triggers.json")
        self._watch_tasks: dict[str, asyncio.Task] = {}
        self._load_triggers()

    # ─── Persistence ──────────────────────────────────────────

    def _load_triggers(self) -> None:
        """Load triggers from JSON file."""
        if os.path.exists(self._triggers_path):
            try:
                with open(self._triggers_path, "r") as f:
                    data = json.load(f)
                self._triggers = data.get("triggers", [])
                logger.info(f"[FILE_WATCHER] Loaded {len(self._triggers)} triggers")
            except Exception as e:
                logger.error(f"[FILE_WATCHER] Failed to load triggers: {e}")
                self._triggers = []
        else:
            self._triggers = []

    def _save_triggers(self) -> None:
        """Persist triggers to JSON file."""
        os.makedirs(os.path.dirname(self._triggers_path), exist_ok=True)
        with open(self._triggers_path, "w") as f:
            json.dump({"triggers": self._triggers}, f, indent=2, default=str)

    # ─── CRUD ─────────────────────────────────────────────────

    async def add_trigger(
        self,
        name: str,
        watch_path: str,
        pattern: str,
        prompt: str,
        agent_name: str | None = None,
    ) -> dict:
        """Create a new file trigger."""
        trigger_id = f"trg-{random.randint(100000000000, 999999999999)}"
        now = datetime.now(timezone.utc).isoformat()

        # Resolve watch_path relative to working_dir if not absolute
        if not os.path.isabs(watch_path):
            watch_path = os.path.join(self.working_dir, watch_path)

        # Ensure watch directory exists
        os.makedirs(watch_path, exist_ok=True)

        trigger = {
            "id": trigger_id,
            "name": name,
            "watch_path": watch_path,
            "pattern": pattern,
            "prompt": prompt,
            "agent_name": agent_name,
            "enabled": True,
            "created_at": now,
            "fire_count": 0,
        }

        self._triggers.append(trigger)
        self._save_triggers()

        # Start watching
        self._start_watcher(trigger)

        logger.info(f"[FILE_WATCHER] Created trigger: {name} ({watch_path}/{pattern})")
        return trigger

    async def remove_trigger(self, trigger_id: str) -> bool:
        """Remove a file trigger and stop its watcher."""
        self._triggers = [t for t in self._triggers if t["id"] != trigger_id]
        self._save_triggers()

        # Cancel watcher task
        task = self._watch_tasks.pop(trigger_id, None)
        if task and not task.done():
            task.cancel()

        logger.info(f"[FILE_WATCHER] Removed trigger: {trigger_id}")
        return True

    async def list_triggers(self) -> list[dict]:
        """List all triggers."""
        return self._triggers

    async def update_trigger(
        self,
        trigger_id: str,
        updates: dict,
    ) -> dict | None:
        """Update a trigger's configuration."""
        for t in self._triggers:
            if t["id"] == trigger_id:
                for k, v in updates.items():
                    if k in ("name", "watch_path", "pattern", "prompt", "agent_name", "enabled"):
                        t[k] = v
                self._save_triggers()

                # Restart watcher if config changed
                task = self._watch_tasks.pop(trigger_id, None)
                if task and not task.done():
                    task.cancel()
                if t.get("enabled", True):
                    self._start_watcher(t)

                return t
        return None

    # ─── File Watching ────────────────────────────────────────

    def _start_watcher(self, trigger: dict) -> None:
        """Start an async file watcher for a trigger."""
        if not trigger.get("enabled", True):
            return

        watch_path = trigger["watch_path"]
        if not os.path.isdir(watch_path):
            logger.warning(
                f"[FILE_WATCHER] Watch path does not exist: {watch_path}"
            )
            return

        task = asyncio.create_task(self._watch_directory(trigger))
        self._watch_tasks[trigger["id"]] = task

    async def _watch_directory(self, trigger: dict) -> None:
        """Watch a directory and fire trigger when matching files change."""
        watch_path = trigger["watch_path"]
        pattern = trigger["pattern"]
        trigger_id = trigger["id"]

        logger.info(
            f"[FILE_WATCHER] Watching: {watch_path} for {pattern}"
        )

        try:
            async for changes in watchfiles.awatch(watch_path):
                for change_type, changed_path in changes:
                    # Only fire on new files, ignore modifications and deletions
                    if change_type != watchfiles.Change.added:
                        continue

                    filename = Path(changed_path).name

                    # Check if filename matches the glob pattern
                    if not fnmatch.fnmatch(filename, pattern):
                        continue

                    logger.info(
                        f"[FILE_WATCHER] Trigger {trigger['name']}: "
                        f"{filename} added"
                    )

                    # Execute the trigger
                    await self._execute_trigger(trigger, filename, "added")

        except asyncio.CancelledError:
            logger.info(f"[FILE_WATCHER] Watcher stopped for: {trigger_id}")
        except Exception as e:
            logger.error(
                f"[FILE_WATCHER] Watcher error for {trigger_id}: {e}",
                exc_info=True,
            )

    async def _execute_trigger(
        self, trigger: dict, filename: str, change_type: str
    ) -> None:
        """Execute a trigger by creating a headless Clyde session."""
        from agents.clyde import ClydeChatManager
        from services.supabase_client import create_session, save_message
        from services.embeddings import generate_embedding

        trigger_name = trigger["name"]
        watch_path = trigger["watch_path"]
        filepath = os.path.join(watch_path, filename)

        # Build the full prompt: user's instruction + automatic file context
        user_prompt = trigger["prompt"]
        prompt = (
            f"A file was {change_type} in the watched folder: {filepath}\n"
            f"Filename: {filename}\n\n"
            f"Task: {user_prompt}"
        )

        logger.info(f"[FILE_WATCHER] Executing trigger: {trigger_name}")

        try:
            # Create a new session
            session_title = f"[Trigger] {trigger_name}: {filename}"
            session = await create_session(session_title)
            session_id = session["id"]

            # Notify connected frontends immediately
            from main import broadcast_session_created
            await broadcast_session_created(session)

            # Create headless manager
            manager = ClydeChatManager(working_dir=self.working_dir, ws=None)
            await manager.initialize()

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
                agent_name="[Trigger]",
            )

            # Execute and collect response
            full_response = ""
            result_data: dict = {}

            async for chunk in manager.send_message(prompt):
                if chunk["type"] == "assistant_text" and chunk["data"].get("final"):
                    full_response = chunk["data"]["text"]
                if chunk["type"] == "result":
                    result_data = chunk["data"]

            # Save response
            if full_response:
                try:
                    clyde_embedding = await generate_embedding(full_response)
                except Exception:
                    clyde_embedding = None

                await save_message(
                    session_id=session_id,
                    role="clyde",
                    content=full_response,
                    embedding=clyde_embedding,
                    agent_name="Clyde",
                    cost_usd=result_data.get("total_cost_usd", 0),
                    metadata={"model": "claude-opus-4-6", "triggered": True},
                )

            await manager.disconnect()

            # Update trigger metadata
            trigger["fire_count"] = trigger.get("fire_count", 0) + 1
            self._save_triggers()

            logger.info(
                f"[FILE_WATCHER] Completed: {trigger_name} "
                f"(session: {session_id}, cost: ${result_data.get('total_cost_usd', 0):.4f})"
            )

        except Exception as e:
            logger.error(
                f"[FILE_WATCHER] Failed to execute {trigger_name}: {e}",
                exc_info=True,
            )

    # ─── Lifecycle ────────────────────────────────────────────

    async def start(self) -> None:
        """Start all enabled trigger watchers."""
        for trigger in self._triggers:
            if trigger.get("enabled", True):
                self._start_watcher(trigger)

        logger.info(
            f"[FILE_WATCHER] Started with {len(self._triggers)} trigger(s)"
        )

    async def stop(self) -> None:
        """Stop all watcher tasks."""
        for trigger_id, task in self._watch_tasks.items():
            if not task.done():
                task.cancel()

        # Wait for all tasks to finish
        if self._watch_tasks:
            await asyncio.gather(
                *self._watch_tasks.values(), return_exceptions=True
            )
        self._watch_tasks.clear()
        logger.info("[FILE_WATCHER] Stopped all watchers")
