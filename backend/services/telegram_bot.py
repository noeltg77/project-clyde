"""
Telegram Bot Service — allows users to chat with Clyde via Telegram.

Supports two modes:
  - polling (default): outbound long-polling, works behind NAT/firewalls
  - webhook: Telegram pushes updates to a public URL (for VPS deployments)

Configuration lives in settings.json (telegram_enabled, telegram_mode, etc.)
and the bot token in .env.local as TELEGRAM_BOT_TOKEN.
"""

import asyncio
import logging
import os
from typing import Any

from services.settings import load_settings
from services.supabase_client import create_session, save_message
from services.embeddings import generate_embedding

logger = logging.getLogger(__name__)

# Lazy-import telegram so a missing package doesn't crash the entire backend.
# The library is only needed when the user actually enables the Telegram bot.
try:
    from telegram import Update
    from telegram.constants import ChatAction, ParseMode
    from telegram.error import BadRequest, TimedOut
    from telegram.ext import (
        Application,
        ApplicationBuilder,
        CommandHandler,
        ContextTypes,
        MessageHandler,
        filters,
    )
    _TELEGRAM_AVAILABLE = True
except ImportError:
    _TELEGRAM_AVAILABLE = False

# Telegram message length limit
_MAX_MESSAGE_LENGTH = 4096


class TelegramService:
    """Manages a Telegram bot that bridges messages to ClydeChatManager."""

    def __init__(self, working_dir: str):
        self.working_dir = working_dir
        self._application: Application | None = None
        self._is_running: bool = False
        self._mode: str = "polling"

        # Per-Telegram-user state
        self._managers: dict[int, Any] = {}  # user_id -> ClydeChatManager
        self._sessions: dict[int, str] = {}  # user_id -> supabase session_id

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the Telegram bot if enabled and configured."""
        settings = load_settings(self.working_dir)
        if not settings.get("telegram_enabled", False):
            logger.info("[Telegram] Disabled in settings")
            return

        if not _TELEGRAM_AVAILABLE:
            logger.warning(
                "[Telegram] python-telegram-bot not installed — "
                "run: pip install python-telegram-bot>=21.0"
            )
            return

        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        if not token:
            logger.warning("[Telegram] No TELEGRAM_BOT_TOKEN set — skipping start")
            return

        self._mode = settings.get("telegram_mode", "polling")
        poll_interval = max(0.5, min(30, settings.get("telegram_polling_interval", 1.0)))
        webhook_url = settings.get("telegram_webhook_url", "").strip()
        allowed_ids = settings.get("telegram_allowed_user_ids", [])

        # Store allowed IDs for the handler to check
        self._allowed_user_ids: list[int] = [int(x) for x in allowed_ids if str(x).isdigit()]

        try:
            self._application = ApplicationBuilder().token(token).build()

            # Register handlers
            self._application.add_handler(CommandHandler("start", self._cmd_start))
            self._application.add_handler(
                MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_message)
            )

            await self._application.initialize()
            await self._application.start()

            if self._mode == "webhook" and webhook_url:
                # Ensure the URL ends with the webhook path
                full_url = webhook_url.rstrip("/")
                if not full_url.endswith("/api/telegram/webhook"):
                    full_url += "/api/telegram/webhook"
                await self._application.bot.set_webhook(url=full_url)
                logger.info(f"[Telegram] Webhook mode — registered at {full_url}")
            else:
                # Default to polling
                self._mode = "polling"
                if self._application.updater:
                    await self._application.updater.start_polling(
                        poll_interval=poll_interval,
                        drop_pending_updates=True,
                    )
                logger.info(f"[Telegram] Polling mode — interval {poll_interval}s")

            self._is_running = True
            bot_info = await self._application.bot.get_me()
            logger.info(f"[Telegram] Bot started: @{bot_info.username}")

        except Exception as e:
            logger.error(f"[Telegram] Failed to start: {e}", exc_info=True)
            self._is_running = False
            self._application = None

    async def stop(self) -> None:
        """Stop the Telegram bot and clean up managers."""
        if not self._application:
            return

        try:
            # Stop polling updater if active
            if self._mode == "polling" and self._application.updater:
                await self._application.updater.stop()

            # Delete webhook if in webhook mode
            if self._mode == "webhook":
                try:
                    await self._application.bot.delete_webhook()
                except Exception:
                    pass

            await self._application.stop()
            await self._application.shutdown()
        except Exception as e:
            logger.warning(f"[Telegram] Error during stop: {e}")

        # Disconnect all ClydeChatManagers
        for user_id, manager in self._managers.items():
            try:
                if manager.client:
                    await manager.client.disconnect()
            except Exception:
                pass

        self._managers.clear()
        self._sessions.clear()
        self._application = None
        self._is_running = False
        logger.info("[Telegram] Bot stopped")

    async def restart(self) -> None:
        """Restart the bot to pick up new settings."""
        await self.stop()
        await self.start()

    # ------------------------------------------------------------------
    # Webhook support
    # ------------------------------------------------------------------

    async def process_webhook_update(self, data: dict) -> None:
        """Process an incoming webhook update from Telegram (called by FastAPI route)."""
        if not self._application:
            return
        update = Update.de_json(data, self._application.bot)
        if update:
            await self._application.process_update(update)

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    async def _cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle /start command."""
        if not update.effective_chat:
            return
        await update.effective_chat.send_message(
            "Hi! I'm Clyde, your AI assistant. Send me a message and I'll help you out.\n\n"
            "Your messages are processed by the Clyde backend running on your machine."
        )

    async def _handle_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle incoming text messages — route through ClydeChatManager."""
        if not update.message or not update.message.text or not update.effective_user:
            return

        user_id = update.effective_user.id
        text = update.message.text
        first_name = update.effective_user.first_name or "User"

        # Security: check allowed user IDs
        if self._allowed_user_ids and user_id not in self._allowed_user_ids:
            await update.message.reply_text(
                "Sorry, you're not authorised to use this bot. "
                "Ask the bot owner to add your Telegram user ID to the allowed list."
            )
            logger.warning(f"[Telegram] Unauthorized user {user_id} ({first_name}) blocked")
            return

        # Show typing indicator
        if update.effective_chat:
            await update.effective_chat.send_action(ChatAction.TYPING)

        try:
            manager = await self._get_or_create_manager(user_id, first_name)

            # Save user message to Supabase
            session_id = self._sessions.get(user_id)
            if session_id:
                asyncio.create_task(self._save_message(session_id, "user", text))

            # Accumulate response from ClydeChatManager
            full_response = ""
            cost_usd = 0.0

            async for chunk in manager.send_message(text):
                chunk_type = chunk.get("type")
                data = chunk.get("data", {})

                if chunk_type == "assistant_text":
                    full_response += data.get("text", "")
                elif chunk_type == "result":
                    cost_usd = data.get("total_cost_usd", 0)

            if not full_response.strip():
                full_response = "(No response generated)"

            # Send reply to Telegram
            await self._send_telegram_message(update, full_response)

            # Save assistant message to Supabase
            if session_id:
                asyncio.create_task(
                    self._save_message(session_id, "assistant", full_response, cost_usd=cost_usd)
                )

        except Exception as e:
            logger.error(f"[Telegram] Error handling message from {user_id}: {e}", exc_info=True)
            try:
                await update.message.reply_text(
                    "Sorry, something went wrong processing your message. Please try again."
                )
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Manager lifecycle
    # ------------------------------------------------------------------

    async def _get_or_create_manager(self, user_id: int, first_name: str) -> Any:
        """Get or create a ClydeChatManager for a Telegram user."""
        if user_id in self._managers:
            return self._managers[user_id]

        # Import here to avoid circular imports
        from agents.clyde import ClydeChatManager

        manager = ClydeChatManager(working_dir=self.working_dir, ws=None)

        # Create a Supabase session for this Telegram user
        try:
            session = await create_session(f"Telegram: {first_name}")
            session_id = session["id"]
            self._sessions[user_id] = session_id
            manager.supabase_session_id = session_id
        except Exception as e:
            logger.warning(f"[Telegram] Failed to create session for user {user_id}: {e}")

        # Initialize the manager (headless mode — ws=None triggers bypassPermissions)
        await manager.initialize()

        self._managers[user_id] = manager
        logger.info(f"[Telegram] Created manager for user {user_id} ({first_name})")
        return manager

    # ------------------------------------------------------------------
    # Message utilities
    # ------------------------------------------------------------------

    async def _save_message(
        self, session_id: str, role: str, content: str, cost_usd: float = 0.0
    ) -> None:
        """Save a message to Supabase with embedding (fire-and-forget)."""
        try:
            embedding = await generate_embedding(content)
            await save_message(
                session_id=session_id,
                role=role,
                content=content,
                embedding=embedding,
                cost_usd=cost_usd,
                metadata={"source": "telegram"},
            )
        except Exception as e:
            logger.warning(f"[Telegram] Failed to save {role} message: {e}")

    async def _send_telegram_message(self, update: Update, text: str) -> None:
        """Send a message to Telegram, splitting if it exceeds the 4096 char limit."""
        if not update.message:
            return

        chunks = self._split_message(text)

        for chunk in chunks:
            try:
                await update.message.reply_text(chunk, parse_mode=ParseMode.MARKDOWN)
            except BadRequest:
                # Markdown parsing failed — fall back to plain text
                try:
                    await update.message.reply_text(chunk)
                except Exception as e:
                    logger.warning(f"[Telegram] Failed to send message chunk: {e}")
            except TimedOut:
                logger.warning("[Telegram] Message send timed out")
            except Exception as e:
                logger.warning(f"[Telegram] Failed to send message chunk: {e}")

    @staticmethod
    def _split_message(text: str) -> list[str]:
        """Split text into chunks that fit within Telegram's message limit."""
        if len(text) <= _MAX_MESSAGE_LENGTH:
            return [text]

        chunks: list[str] = []
        remaining = text

        while remaining:
            if len(remaining) <= _MAX_MESSAGE_LENGTH:
                chunks.append(remaining)
                break

            # Try to split on double newline
            split_pos = remaining.rfind("\n\n", 0, _MAX_MESSAGE_LENGTH)
            if split_pos == -1:
                # Try single newline
                split_pos = remaining.rfind("\n", 0, _MAX_MESSAGE_LENGTH)
            if split_pos == -1:
                # Try space
                split_pos = remaining.rfind(" ", 0, _MAX_MESSAGE_LENGTH)
            if split_pos == -1:
                # Hard split
                split_pos = _MAX_MESSAGE_LENGTH

            chunks.append(remaining[:split_pos])
            remaining = remaining[split_pos:].lstrip("\n")

        return chunks

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    @property
    def is_running(self) -> bool:
        return self._is_running

    @property
    def status(self) -> dict:
        return {
            "running": self._is_running,
            "mode": self._mode if self._is_running else None,
            "active_chats": len(self._managers),
        }
