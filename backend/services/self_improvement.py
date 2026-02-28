"""
SelfImprovementService — Evaluates agent performance, rewrites system prompts,
and analyses team gaps. Uses headless ClydeChatManager sessions for prompt
optimisation and the PerformanceLogger for data analysis.
"""

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


class SelfImprovementService:
    """Analyses agent performance and drives prompt optimisation."""

    def __init__(self, working_dir: str):
        self.working_dir = working_dir

    def _load_prompt(self, prompt_rel_path: str) -> str:
        """Read an agent's system prompt from disk."""
        abs_path = os.path.join(
            self.working_dir,
            prompt_rel_path.replace("/working/", "", 1),
        )
        if os.path.exists(abs_path):
            with open(abs_path, "r") as f:
                return f.read()
        return ""

    def _save_prompt(self, prompt_rel_path: str, content: str) -> None:
        """Write an agent's system prompt to disk (atomic)."""
        abs_path = os.path.join(
            self.working_dir,
            prompt_rel_path.replace("/working/", "", 1),
        )
        tmp_path = abs_path + ".tmp"
        with open(tmp_path, "w") as f:
            f.write(content)
        os.replace(tmp_path, abs_path)

    async def evaluate_and_improve(
        self,
        agent_id: str,
        agent_name: str,
        prompt_path: str,
        performance_data: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Evaluate an agent's performance and generate an improved prompt.

        Returns a dict with:
        - improved: bool — whether an improvement was made
        - reason: str — why the change was made (or why not)
        - new_prompt: str | None — the improved prompt text (if improved)
        """
        from services.settings import load_settings

        settings = load_settings(self.working_dir)
        self_edit_enabled = settings.get("self_edit_enabled", True)

        if not self_edit_enabled:
            return {
                "improved": False,
                "reason": "Self-editing is disabled by the user.",
                "new_prompt": None,
            }

        # Check if there's enough data to justify an improvement
        total_tasks = performance_data.get("total_tasks", 0)
        if total_tasks < 3:
            return {
                "improved": False,
                "reason": f"Not enough data to evaluate ({total_tasks} tasks). Need at least 3.",
                "new_prompt": None,
            }

        # Check for negative feedback patterns
        negative = performance_data.get("feedback_breakdown", {}).get("negative", 0)
        positive = performance_data.get("feedback_breakdown", {}).get("positive", 0)
        error_count = total_tasks - int(
            total_tasks * performance_data.get("success_rate", 100) / 100
        )

        if negative == 0 and error_count == 0:
            return {
                "improved": False,
                "reason": "No negative feedback or errors detected. No improvement needed.",
                "new_prompt": None,
            }

        # Load the current prompt
        current_prompt = self._load_prompt(prompt_path)
        if not current_prompt:
            return {
                "improved": False,
                "reason": "Could not read current system prompt.",
                "new_prompt": None,
            }

        # Build the meta-prompt for Clyde to generate an improved version
        recent_logs = performance_data.get("recent_logs", [])
        log_summary = ""
        for log in recent_logs[-5:]:
            fb = log.get("user_feedback", "none")
            err = "ERROR" if log.get("is_error") else "OK"
            desc = (log.get("description", "") or "")[:100]
            log_summary += f"  - [{err}] [{fb}] {desc}\n"

        improvement_prompt = (
            f"You are reviewing the performance of agent '{agent_name}' "
            f"(id: {agent_id}).\n\n"
            f"## Performance Summary\n"
            f"- Total tasks: {total_tasks}\n"
            f"- Success rate: {performance_data.get('success_rate', 0)}%\n"
            f"- Positive feedback: {positive}\n"
            f"- Negative feedback: {negative}\n"
            f"- Errors: {error_count}\n\n"
            f"## Recent Task Logs\n{log_summary}\n"
            f"## Current System Prompt\n```\n{current_prompt}\n```\n\n"
            f"## Instructions\n"
            f"Analyse the performance data above and identify specific "
            f"weaknesses in the agent's system prompt that could be causing "
            f"negative feedback or errors.\n\n"
            f"Then rewrite the system prompt to address those issues while "
            f"preserving everything that works well.\n\n"
            f"Return ONLY the improved system prompt text — no explanations, "
            f"no markdown code blocks, just the raw prompt content."
        )

        # Execute via headless Clyde session
        try:
            from agents.clyde import ClydeChatManager

            manager = ClydeChatManager(working_dir=self.working_dir, ws=None)
            await manager.initialize()

            improved_prompt = ""
            async for chunk in manager.send_message(improvement_prompt):
                if chunk["type"] == "assistant_text" and chunk["data"].get("final"):
                    improved_prompt = chunk["data"]["text"]

            await manager.disconnect()

            if improved_prompt and len(improved_prompt) > 50:
                return {
                    "improved": True,
                    "reason": (
                        f"Improved based on {negative} negative feedbacks and "
                        f"{error_count} errors out of {total_tasks} tasks."
                    ),
                    "new_prompt": improved_prompt,
                }
            else:
                return {
                    "improved": False,
                    "reason": "Clyde did not produce a valid improved prompt.",
                    "new_prompt": None,
                }

        except Exception as e:
            logger.error(f"[SELF-IMPROVE] Failed to generate improvement: {e}")
            return {
                "improved": False,
                "reason": f"Error during improvement: {str(e)}",
                "new_prompt": None,
            }

    async def check_auto_rollback(
        self,
        agent_id: str,
        performance_logger: Any,
    ) -> dict[str, Any]:
        """
        Check if an agent should have its prompt auto-rolled back.

        Returns:
        - should_rollback: bool
        - streak: int — the negative feedback streak count
        """
        streak = performance_logger.get_negative_streak(agent_id)
        return {
            "should_rollback": streak >= 3,
            "streak": streak,
        }

    def analyse_gaps(
        self,
        performance_logger: Any,
        supabase_active_agents: set[str] | None = None,
    ) -> dict[str, Any]:
        """
        Analyse the team for gaps and underutilised agents.

        Returns recommendations for team improvements.

        Args:
            performance_logger: PerformanceLogger instance for local JSONL stats.
            supabase_active_agents: Optional set of agent names from the
                activity_events table. Merged with performance data so agents
                used in chat sessions are correctly recognised as active.
        """
        from services.registry import load_registry

        registry = load_registry(self.working_dir)
        agents = registry.get("agents", [])
        stats = performance_logger.get_all_stats(days=30)

        # Build a set of agents that have been used — from local perf logs
        active_agent_names = {
            a["agent_name"] for a in stats.get("by_agent", []) if a["tasks"] > 0
        }

        # Merge with Supabase activity_events (the authoritative usage source)
        if supabase_active_agents:
            active_agent_names |= supabase_active_agents

        recommendations = []

        # Find idle agents
        for agent in agents:
            if agent.get("status") == "active" and agent["name"] not in active_agent_names:
                recommendations.append({
                    "type": "archive_candidate",
                    "agent_name": agent["name"],
                    "agent_id": agent["id"],
                    "reason": f"{agent['name']} has not been used in the last 30 days.",
                })

        # Find agents with poor performance
        for agent_stat in stats.get("by_agent", []):
            if agent_stat["tasks"] >= 3 and agent_stat["success_rate"] < 70:
                recommendations.append({
                    "type": "needs_improvement",
                    "agent_name": agent_stat["agent_name"],
                    "reason": (
                        f"{agent_stat['agent_name']} has a {agent_stat['success_rate']}% "
                        f"success rate over {agent_stat['tasks']} tasks."
                    ),
                })

            if (
                agent_stat["tasks"] >= 5
                and agent_stat.get("negative_feedback", 0)
                > agent_stat.get("positive_feedback", 0)
            ):
                recommendations.append({
                    "type": "negative_trend",
                    "agent_name": agent_stat["agent_name"],
                    "reason": (
                        f"{agent_stat['agent_name']} has more negative than positive "
                        f"feedback ({agent_stat.get('negative_feedback', 0)} vs "
                        f"{agent_stat.get('positive_feedback', 0)})."
                    ),
                })

        return {
            "total_agents": len(agents),
            "active_agents": len([a for a in agents if a.get("status") == "active"]),
            "agents_used_last_30_days": len(active_agent_names),
            "recommendations": recommendations,
        }
