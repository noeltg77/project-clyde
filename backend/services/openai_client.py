"""
OpenAI Client — lightweight wrapper around the OpenAI SDK for subagent tasks.

Handles API calls, token counting, and cost calculation for OpenAI subagents.
OpenAI subagents are tool-free (prompt-in/text-out only).
Reuses the same OPENAI_API_KEY used for embeddings.
"""

import asyncio
import logging
import os
from typing import Any

from services.settings import OPENAI_PRICING

logger = logging.getLogger(__name__)

# Lazy-initialised client (created on first call)
_client: Any = None


def _get_client() -> Any:
    """Get or create the OpenAI client."""
    global _client
    if _client is not None:
        return _client

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY environment variable is not set. "
            "This is the same key used for embeddings — add it in Settings."
        )

    from openai import OpenAI

    _client = OpenAI(api_key=api_key)
    return _client


def _calculate_cost(
    model: str, input_tokens: int, output_tokens: int
) -> float:
    """Calculate USD cost from token counts and model pricing."""
    pricing = OPENAI_PRICING.get(model)
    if pricing is None:
        logger.warning(f"[OPENAI] No pricing found for model {model}, using 0 cost")
        return 0.0

    input_rate, output_rate = pricing
    cost = (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
    return round(cost, 6)


def _sync_call_openai(
    model: str,
    system_prompt: str,
    user_prompt: str,
) -> dict:
    """Synchronous OpenAI API call (run in thread for async compat)."""
    client = _get_client()

    response = client.responses.create(
        model=model,
        instructions=system_prompt or None,
        input=user_prompt,
    )

    # Extract text content
    content = response.output_text or ""

    # Extract token counts from usage
    usage = response.usage
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0

    cost = _calculate_cost(model, input_tokens, output_tokens)

    return {
        "content": content,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": cost,
        "model": model,
    }


async def call_openai(
    model: str,
    system_prompt: str,
    user_prompt: str,
) -> dict:
    """Call OpenAI API asynchronously.

    Args:
        model: OpenAI API model ID (e.g. "gpt-5.4")
        system_prompt: System instructions for the model
        user_prompt: The task/message to send

    Returns:
        {
            "content": str,          # Response text
            "input_tokens": int,     # Prompt token count
            "output_tokens": int,    # Response token count
            "cost_usd": float,       # Calculated cost in USD
            "model": str,            # Model ID used
        }
    """
    logger.info(f"[OPENAI] Calling model={model}, prompt_len={len(user_prompt)}")

    try:
        result = await asyncio.to_thread(
            _sync_call_openai, model, system_prompt, user_prompt
        )
        logger.info(
            f"[OPENAI] Response: {result['input_tokens']} in, "
            f"{result['output_tokens']} out, ${result['cost_usd']:.6f}"
        )
        return result

    except Exception as e:
        logger.error(f"[OPENAI] API call failed: {e}")
        raise
