"""
PerformanceLogger — Tracks per-turn performance data in JSONL format.

Logs are appended to working/logs/performance.jsonl and used by the
self-improvement loop to evaluate agent effectiveness and drive prompt
optimisation.
"""

import gzip
import json
import logging
import os
import shutil
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Maximum log file size before rotation (10 MB)
_MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024


class PerformanceLogger:
    """Append-only JSONL performance logger with rotation and query helpers."""

    def __init__(self, working_dir: str):
        self.working_dir = working_dir
        self.logs_dir = os.path.join(working_dir, "logs")
        self.log_path = os.path.join(self.logs_dir, "performance.jsonl")
        os.makedirs(self.logs_dir, exist_ok=True)

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def log_event(
        self,
        *,
        session_id: str,
        agent_id: str = "clyde-001",
        agent_name: str = "Clyde",
        task_type: str = "direct",
        description: str = "",
        completion_time_ms: int = 0,
        total_cost_usd: float = 0.0,
        model: str = "opus",
        user_feedback: str | None = None,
        is_error: bool = False,
        num_turns: int = 0,
        prompt_version: int = 0,
    ) -> dict:
        """Append a performance entry. Returns the written record."""
        self._maybe_rotate()

        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "task_type": task_type,
            "description": description,
            "completion_time_ms": completion_time_ms,
            "total_cost_usd": round(total_cost_usd, 6),
            "model": model,
            "user_feedback": user_feedback,
            "is_error": is_error,
            "num_turns": num_turns,
            "prompt_version": prompt_version,
        }

        try:
            with open(self.log_path, "a") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception as e:
            logger.error(f"[PERF] Failed to write log entry: {e}")

        return entry

    def record_feedback(
        self, session_id: str, message_timestamp: str, feedback: str
    ) -> bool:
        """Update the user_feedback field on a matching log entry.

        Since JSONL is append-only we rewrite the file — acceptable for the
        expected file sizes (< 10 MB before rotation).
        """
        if not os.path.exists(self.log_path):
            return False

        lines = self._read_lines()
        updated = False

        for i, entry in enumerate(lines):
            if (
                entry.get("session_id") == session_id
                and entry.get("user_feedback") is None
            ):
                # Match by proximity to the provided message timestamp
                entry["user_feedback"] = feedback
                updated = True
                break  # Update the first un-rated entry for this session

        if updated:
            self._write_lines(lines)

        return updated

    # ------------------------------------------------------------------
    # Read / Query
    # ------------------------------------------------------------------

    def get_all_stats(self, days: int = 30) -> dict[str, Any]:
        """Aggregated performance stats across all agents."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        entries = self._read_since(cutoff)

        if not entries:
            return {
                "total_tasks": 0,
                "success_rate": 0.0,
                "avg_completion_ms": 0,
                "total_cost_usd": 0.0,
                "by_agent": [],
                "feedback_breakdown": {"positive": 0, "negative": 0, "none": 0},
            }

        total = len(entries)
        errors = sum(1 for e in entries if e.get("is_error"))
        feedbacks = {"positive": 0, "negative": 0, "none": 0}
        for e in entries:
            fb = e.get("user_feedback")
            if fb == "positive":
                feedbacks["positive"] += 1
            elif fb == "negative":
                feedbacks["negative"] += 1
            else:
                feedbacks["none"] += 1

        agent_map: dict[str, dict] = defaultdict(
            lambda: {
                "tasks": 0,
                "errors": 0,
                "total_cost_usd": 0.0,
                "total_time_ms": 0,
                "positive": 0,
                "negative": 0,
            }
        )
        for e in entries:
            name = e.get("agent_name", "Unknown")
            agent_map[name]["tasks"] += 1
            if e.get("is_error"):
                agent_map[name]["errors"] += 1
            agent_map[name]["total_cost_usd"] += e.get("total_cost_usd", 0)
            agent_map[name]["total_time_ms"] += e.get("completion_time_ms", 0)
            if e.get("user_feedback") == "positive":
                agent_map[name]["positive"] += 1
            elif e.get("user_feedback") == "negative":
                agent_map[name]["negative"] += 1

        by_agent = []
        for name, data in sorted(
            agent_map.items(), key=lambda x: x[1]["tasks"], reverse=True
        ):
            tasks = data["tasks"]
            # Count failures as errors OR negative feedback (deduplicated)
            failures = data["errors"] + data["negative"]
            # Clamp so failures can't exceed total tasks
            failures = min(failures, tasks)
            by_agent.append({
                "agent_name": name,
                "tasks": tasks,
                "errors": data["errors"],
                "success_rate": round(
                    (tasks - failures) / tasks * 100, 1
                ) if tasks else 0,
                "avg_completion_ms": round(data["total_time_ms"] / tasks) if tasks else 0,
                "total_cost_usd": round(data["total_cost_usd"], 4),
                "positive_feedback": data["positive"],
                "negative_feedback": data["negative"],
            })

        avg_time = (
            round(sum(e.get("completion_time_ms", 0) for e in entries) / total)
            if total
            else 0
        )

        # Overall: count tasks that errored or received negative feedback as failures
        total_failures = min(errors + feedbacks["negative"], total)
        overall_success = round((total - total_failures) / total * 100, 1) if total else 0

        return {
            "total_tasks": total,
            "success_rate": overall_success,
            "overall_success_rate": overall_success,
            "total_agents": len(agent_map),
            "avg_completion_ms": avg_time,
            "total_cost_usd": round(
                sum(e.get("total_cost_usd", 0) for e in entries), 4
            ),
            "by_agent": by_agent,
            "feedback_breakdown": feedbacks,
        }

    def get_agent_stats(self, agent_id: str, days: int = 30) -> dict[str, Any]:
        """Performance stats for a specific agent."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        entries = [
            e for e in self._read_since(cutoff)
            if e.get("agent_id") == agent_id or e.get("agent_name") == agent_id
        ]

        if not entries:
            return {
                "agent_id": agent_id,
                "total_tasks": 0,
                "success_rate": 0.0,
                "avg_completion_ms": 0,
                "total_cost_usd": 0.0,
                "feedback_breakdown": {"positive": 0, "negative": 0, "none": 0},
                "recent_logs": [],
            }

        total = len(entries)
        errors = sum(1 for e in entries if e.get("is_error"))
        feedbacks = {"positive": 0, "negative": 0, "none": 0}
        for e in entries:
            fb = e.get("user_feedback")
            if fb == "positive":
                feedbacks["positive"] += 1
            elif fb == "negative":
                feedbacks["negative"] += 1
            else:
                feedbacks["none"] += 1

        avg_time = (
            round(sum(e.get("completion_time_ms", 0) for e in entries) / total)
            if total
            else 0
        )

        return {
            "agent_id": agent_id,
            "total_tasks": total,
            "success_rate": round((total - errors) / total * 100, 1) if total else 0,
            "avg_completion_ms": avg_time,
            "total_cost_usd": round(
                sum(e.get("total_cost_usd", 0) for e in entries), 4
            ),
            "feedback_breakdown": feedbacks,
            "recent_logs": entries[-10:],
        }

    def get_recent_logs(self, agent_id: str | None = None, limit: int = 20) -> list[dict]:
        """Return the most recent log entries, optionally filtered by agent."""
        lines = self._read_lines()
        if agent_id:
            lines = [
                e for e in lines
                if e.get("agent_id") == agent_id or e.get("agent_name") == agent_id
            ]
        return lines[-limit:]

    def get_negative_streak(self, agent_id: str) -> int:
        """Count consecutive negative feedbacks since the last prompt change."""
        lines = self._read_lines()
        agent_lines = [
            e for e in lines
            if e.get("agent_id") == agent_id or e.get("agent_name") == agent_id
        ]
        # Count from the end backwards
        streak = 0
        for entry in reversed(agent_lines):
            if entry.get("user_feedback") == "negative":
                streak += 1
            elif entry.get("user_feedback") == "positive":
                break
            # None feedback doesn't break or extend the streak
        return streak

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _read_lines(self) -> list[dict]:
        """Read all entries from the current log file."""
        if not os.path.exists(self.log_path):
            return []
        entries = []
        with open(self.log_path, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        return entries

    def _write_lines(self, entries: list[dict]) -> None:
        """Rewrite the log file with the given entries (atomic)."""
        tmp_path = self.log_path + ".tmp"
        with open(tmp_path, "w") as f:
            for entry in entries:
                f.write(json.dumps(entry) + "\n")
        os.replace(tmp_path, self.log_path)

    def _read_since(self, cutoff: datetime) -> list[dict]:
        """Read entries newer than cutoff."""
        entries = self._read_lines()
        result = []
        cutoff_iso = cutoff.isoformat()
        for e in entries:
            ts = e.get("timestamp", "")
            if ts >= cutoff_iso:
                result.append(e)
        return result

    def _maybe_rotate(self) -> None:
        """Archive the log file if it exceeds the size limit."""
        if not os.path.exists(self.log_path):
            return
        try:
            size = os.path.getsize(self.log_path)
        except OSError:
            return

        if size >= _MAX_LOG_SIZE_BYTES:
            ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            archive_path = os.path.join(self.logs_dir, f"performance-{ts}.jsonl.gz")
            try:
                with open(self.log_path, "rb") as f_in:
                    with gzip.open(archive_path, "wb") as f_out:
                        shutil.copyfileobj(f_in, f_out)
                # Truncate the current file
                with open(self.log_path, "w") as f:
                    pass
                logger.info(f"[PERF] Rotated log to {archive_path}")
            except Exception as e:
                logger.error(f"[PERF] Failed to rotate log: {e}")
