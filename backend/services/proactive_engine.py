"""
ProactiveEngine — Periodic analysis engine for Phase 6 Proactive Mode.

Orchestrates data collection from performance logs, chat history, and
the agent registry to generate proactive insights and recommendations.
Runs on a configurable schedule (default: every 6 hours).
"""

import json
import logging
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


class ProactiveEngine:
    """Analyses system data and generates proactive insights."""

    def __init__(self, working_dir: str):
        self.working_dir = working_dir

    async def run_analysis(self) -> list[dict]:
        """Execute all analysis passes and return new insights."""
        logger.info("[ProactiveEngine] Starting analysis run")

        all_insights: list[dict] = []

        try:
            # Run all analysis passes
            usage_insights = await self._analyse_usage_patterns()
            all_insights.extend(usage_insights)
        except Exception as e:
            logger.error(f"[ProactiveEngine] Usage pattern analysis failed: {e}")

        try:
            health_insights = await self._analyse_agent_health()
            all_insights.extend(health_insights)
        except Exception as e:
            logger.error(f"[ProactiveEngine] Agent health analysis failed: {e}")

        try:
            workflow_insights = await self._analyse_workflow_opportunities()
            all_insights.extend(workflow_insights)
        except Exception as e:
            logger.error(f"[ProactiveEngine] Workflow analysis failed: {e}")

        # Deduplicate against recent existing insights
        deduped = await self._deduplicate_insights(all_insights)

        # Optionally enhance descriptions with headless Clyde
        enhanced = await self._enhance_with_clyde(deduped)

        # Persist each insight to Supabase
        saved: list[dict] = []
        for insight in enhanced:
            try:
                from services.supabase_client import save_insight

                result = await save_insight(
                    insight_type=insight["insight_type"],
                    title=insight["title"],
                    description=insight["description"],
                    severity=insight.get("severity", "info"),
                    data=insight.get("data", {}),
                )
                if result:
                    saved.append(result)
            except Exception as e:
                logger.error(f"[ProactiveEngine] Failed to save insight: {e}")

        logger.info(
            f"[ProactiveEngine] Analysis complete: "
            f"{len(all_insights)} raw → {len(deduped)} deduped → {len(saved)} saved"
        )
        return saved

    # ─── Usage Pattern Analysis ─────────────────────────────────

    async def _analyse_usage_patterns(self) -> list[dict]:
        """Detect recurring task types in recent user messages."""
        from services.supabase_client import get_recent_message_contents

        messages = await get_recent_message_contents(days=14, limit=200)
        if not messages:
            return []

        # Extract meaningful phrases from user messages
        phrase_counter: Counter[str] = Counter()
        for msg in messages:
            content = (msg.get("content") or "").lower().strip()
            if len(content) < 10:
                continue
            # Extract bigrams and trigrams from content
            words = re.findall(r"[a-z]+", content)
            for n in (2, 3):
                for i in range(len(words) - n + 1):
                    phrase = " ".join(words[i : i + n])
                    # Filter out very common/useless phrases
                    if self._is_meaningful_phrase(phrase):
                        phrase_counter[phrase] += 1

        # Find patterns that appear 5+ times
        insights: list[dict] = []
        from services.registry import get_active_agents

        active_agents = get_active_agents(self.working_dir)
        agent_roles = [a.get("role", "").lower() for a in active_agents]

        for phrase, count in phrase_counter.most_common(5):
            if count < 5:
                continue

            # Check if a matching agent already exists
            has_match = any(phrase in role or role in phrase for role in agent_roles)
            if has_match:
                continue

            insights.append({
                "insight_type": "agent_suggestion",
                "title": f"Recurring pattern: {phrase}",
                "description": (
                    f"You've mentioned \"{phrase}\" {count} times in the last "
                    f"14 days. Consider creating a dedicated specialist agent "
                    f"for this type of work."
                ),
                "severity": "info",
                "data": {
                    "pattern": phrase,
                    "frequency": count,
                    "days": 14,
                },
            })

        return insights[:3]  # Cap at 3 suggestions per run

    def _is_meaningful_phrase(self, phrase: str) -> bool:
        """Filter out common/useless bigrams and trigrams."""
        stopwords = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "could", "should", "may", "might", "shall", "can",
            "to", "of", "in", "for", "on", "with", "at", "by", "from",
            "as", "into", "through", "during", "before", "after", "above",
            "below", "between", "and", "but", "or", "not", "so", "if",
            "this", "that", "these", "those", "it", "its", "my", "your",
            "his", "her", "our", "their", "what", "which", "who", "whom",
            "when", "where", "why", "how", "all", "each", "every", "both",
            "i", "you", "he", "she", "we", "they", "me", "him", "us",
            "them", "please", "thanks", "thank", "just", "also", "like",
            "get", "make", "know", "think", "want", "need", "use", "try",
        }
        words = phrase.split()
        # Skip if all words are stopwords
        if all(w in stopwords for w in words):
            return False
        # Skip very short phrases
        if len(phrase) < 6:
            return False
        return True

    # ─── Agent Health Analysis ──────────────────────────────────

    async def _analyse_agent_health(self) -> list[dict]:
        """Check agent utilisation, performance trends, idle agents."""
        from services.performance_logger import PerformanceLogger
        from services.self_improvement import SelfImprovementService
        from services.supabase_client import get_recently_active_agents

        perf_logger = PerformanceLogger(self.working_dir)
        service = SelfImprovementService(self.working_dir)

        # Fetch agents that have activity_events in Supabase (the real usage data)
        try:
            supabase_active = await get_recently_active_agents(days=30)
        except Exception as e:
            logger.warning(f"[PROACTIVE] Failed to fetch Supabase activity: {e}")
            supabase_active = set()

        # Get gap analysis — now cross-references both perf logs AND Supabase activity
        gaps = service.analyse_gaps(perf_logger, supabase_active_agents=supabase_active)
        recommendations = gaps.get("recommendations", [])

        insights: list[dict] = []
        for rec in recommendations:
            rec_type = rec.get("type")
            agent_name = rec.get("agent_name", "Unknown")
            reason = rec.get("reason", "")

            if rec_type == "archive_candidate":
                insights.append({
                    "insight_type": "agent_archival",
                    "title": f"{agent_name} may be ready to archive",
                    "description": reason,
                    "severity": "warning",
                    "data": {
                        "agent_name": agent_name,
                        "agent_id": rec.get("agent_id"),
                        "type": "archive_candidate",
                    },
                })
            elif rec_type == "needs_improvement":
                insights.append({
                    "insight_type": "performance_trend",
                    "title": f"{agent_name} needs improvement",
                    "description": reason,
                    "severity": "action_required",
                    "data": {
                        "agent_name": agent_name,
                        "type": "needs_improvement",
                        "trend": "negative",
                    },
                })
            elif rec_type == "negative_trend":
                insights.append({
                    "insight_type": "performance_trend",
                    "title": f"{agent_name} has negative feedback trend",
                    "description": reason,
                    "severity": "warning",
                    "data": {
                        "agent_name": agent_name,
                        "type": "negative_trend",
                        "trend": "negative",
                    },
                })

        # Also detect positive trends — agents that have improved
        try:
            all_stats = perf_logger.get_all_stats(days=30)
            recent_stats = perf_logger.get_all_stats(days=7)

            for agent_30 in all_stats.get("by_agent", []):
                name = agent_30.get("agent_name")
                rate_30 = agent_30.get("success_rate", 0)
                tasks_30 = agent_30.get("tasks", 0)

                if tasks_30 < 10:
                    continue  # Not enough data for trend

                # Find the same agent in 7-day stats
                agent_7 = next(
                    (a for a in recent_stats.get("by_agent", [])
                     if a.get("agent_name") == name),
                    None,
                )
                if not agent_7 or agent_7.get("tasks", 0) < 3:
                    continue

                rate_7 = agent_7.get("success_rate", 0)
                improvement = rate_7 - rate_30

                if improvement >= 15:  # 15%+ improvement
                    insights.append({
                        "insight_type": "performance_trend",
                        "title": f"{name} is improving",
                        "description": (
                            f"{name}'s success rate improved from "
                            f"{rate_30:.0f}% to {rate_7:.0f}% over the last "
                            f"7 days — a {improvement:.0f}% improvement."
                        ),
                        "severity": "info",
                        "data": {
                            "agent_name": name,
                            "type": "positive_trend",
                            "trend": "positive",
                            "rate_30d": rate_30,
                            "rate_7d": rate_7,
                            "improvement": improvement,
                        },
                    })
        except Exception as e:
            logger.warning(f"[ProactiveEngine] Positive trend analysis failed: {e}")

        return insights

    # ─── Workflow Opportunity Analysis ──────────────────────────

    async def _analyse_workflow_opportunities(self) -> list[dict]:
        """Detect potential workflow optimisations via semantic clustering."""
        try:
            from services.embeddings import generate_query_embedding
            from services.supabase_client import search_messages
        except ImportError:
            logger.warning("[ProactiveEngine] Embeddings not available, skipping workflow analysis")
            return []

        # Use the top phrases from usage patterns to find semantic clusters
        from services.supabase_client import get_recent_message_contents

        messages = await get_recent_message_contents(days=14, limit=100)
        if len(messages) < 10:
            return []

        # Pick 3 representative messages to use as search probes
        probe_messages = [
            m.get("content", "")
            for m in messages[:10]
            if len(m.get("content", "")) > 20
        ][:3]

        insights: list[dict] = []
        seen_patterns: set[str] = set()

        for probe in probe_messages:
            try:
                embedding = await generate_query_embedding(probe[:500])
                results = await search_messages(
                    query_embedding=embedding,
                    threshold=0.5,
                    limit=10,
                )

                if len(results) >= 5:
                    # Found a cluster of similar requests
                    unique_sessions = set(
                        r.get("session_id") for r in results
                    )
                    if len(unique_sessions) >= 2:
                        # Pattern spans multiple sessions — worth suggesting
                        snippet = probe[:60].strip()
                        if snippet in seen_patterns:
                            continue
                        seen_patterns.add(snippet)

                        insights.append({
                            "insight_type": "workflow_optimisation",
                            "title": "Recurring workflow detected",
                            "description": (
                                f"Found {len(results)} similar requests "
                                f"across {len(unique_sessions)} sessions "
                                f"related to: \"{snippet}...\". Consider "
                                f"creating a skill document or scheduled task."
                            ),
                            "severity": "info",
                            "data": {
                                "probe_text": probe[:200],
                                "match_count": len(results),
                                "session_count": len(unique_sessions),
                            },
                        })
            except Exception as e:
                logger.warning(f"[ProactiveEngine] Semantic probe failed: {e}")
                continue

        return insights[:2]  # Cap at 2 workflow suggestions per run

    # ─── Deduplication ──────────────────────────────────────────

    async def _deduplicate_insights(self, new_insights: list[dict]) -> list[dict]:
        """Remove insights that duplicate recent existing ones."""
        from services.supabase_client import get_all_insights

        existing = await get_all_insights(limit=50)
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()

        # Build set of recent (type, key_data) tuples
        recent_keys: set[str] = set()
        for ex in existing:
            created = ex.get("created_at", "")
            if created < cutoff:
                continue
            key = self._insight_dedup_key(ex)
            recent_keys.add(key)

        deduped: list[dict] = []
        for insight in new_insights:
            key = self._insight_dedup_key(insight)
            if key not in recent_keys:
                deduped.append(insight)
                recent_keys.add(key)  # Prevent self-duplication

        return deduped

    def _insight_dedup_key(self, insight: dict) -> str:
        """Generate a deduplication key from an insight."""
        itype = insight.get("insight_type", "")
        data = insight.get("data", {})
        # Use agent_name or pattern as the distinguishing key
        agent = data.get("agent_name", "")
        pattern = data.get("pattern", "")
        return f"{itype}:{agent}:{pattern}"

    # ─── Optional: Enhance with Headless Clyde ──────────────────

    async def _enhance_with_clyde(self, insights: list[dict]) -> list[dict]:
        """Optionally use a headless Clyde session to rewrite insight descriptions."""
        from services.settings import load_settings

        settings = load_settings(self.working_dir)
        proactive_enabled = settings.get("proactive_mode_enabled", True)

        if not proactive_enabled or not insights:
            return insights

        # Only enhance for action_required severity to save API cost
        to_enhance = [i for i in insights if i.get("severity") == "action_required"]
        if not to_enhance:
            return insights

        try:
            from agents.clyde import ClydeChatManager

            manager = ClydeChatManager(working_dir=self.working_dir, ws=None)
            await manager.initialize()

            for insight in to_enhance:
                prompt = (
                    f"You are writing a brief notification for the user. "
                    f"Rewrite this insight in a natural, conversational tone "
                    f"as if Clyde is speaking directly to the user. "
                    f"Keep it to 1-2 sentences maximum.\n\n"
                    f"Type: {insight['insight_type']}\n"
                    f"Title: {insight['title']}\n"
                    f"Raw description: {insight['description']}\n"
                    f"Data: {json.dumps(insight.get('data', {}))}\n\n"
                    f"Return ONLY the rewritten description, nothing else."
                )

                response_text = ""
                async for chunk in manager.send_message(prompt):
                    if chunk.get("type") == "assistant_text":
                        text = chunk.get("data", {}).get("text", "")
                        if text:
                            response_text = text

                if response_text and len(response_text) > 10:
                    insight["description"] = response_text.strip()

            await manager.disconnect()
        except Exception as e:
            logger.warning(
                f"[ProactiveEngine] Headless Clyde enhancement failed: {e}"
            )
            # Fall through with template descriptions

        return insights
