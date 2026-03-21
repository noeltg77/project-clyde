"""
Gemini Client — lightweight wrapper around the Google GenAI SDK.

Handles API calls, token counting, and cost calculation for Gemini subagents.
Gemini subagents are tool-free (prompt-in/text-out only).
"""

import asyncio
import logging
import os
from typing import Any

from services.settings import (
    GEMINI_PRICING,
    GEMINI_PRO_LONG_CONTEXT_PRICING,
)

logger = logging.getLogger(__name__)

# Lazy-initialised client (created on first call)
_client: Any = None


def _get_client() -> Any:
    """Get or create the Google GenAI client."""
    global _client
    if _client is not None:
        return _client

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY environment variable is not set. "
            "Add it to your .env file to use Gemini subagents."
        )

    from google import genai  # type: ignore

    _client = genai.Client(api_key=api_key)
    return _client


def _calculate_cost(
    model: str, input_tokens: int, output_tokens: int
) -> float:
    """Calculate USD cost from token counts and model pricing."""
    pricing = GEMINI_PRICING.get(model)
    if pricing is None:
        logger.warning(f"[GEMINI] No pricing found for model {model}, using 0 cost")
        return 0.0

    input_rate, output_rate = pricing

    # Pro model has higher pricing above 200k input tokens
    if model == "gemini-3.1-pro-preview" and input_tokens > 200_000:
        input_rate, output_rate = GEMINI_PRO_LONG_CONTEXT_PRICING

    cost = (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
    return round(cost, 6)


def _sync_call_gemini(
    model: str,
    system_prompt: str,
    user_prompt: str,
) -> dict:
    """Synchronous Gemini API call (run in thread for async compat)."""
    client = _get_client()

    from google.genai import types  # type: ignore

    response = client.models.generate_content(
        model=model,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=1.0,
        ),
    )

    # Extract text content
    content = response.text or ""

    # Extract token counts from usage metadata
    usage = response.usage_metadata
    input_tokens = getattr(usage, "prompt_token_count", 0) or 0
    output_tokens = getattr(usage, "candidates_token_count", 0) or 0

    cost = _calculate_cost(model, input_tokens, output_tokens)

    return {
        "content": content,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": cost,
        "model": model,
    }


async def call_gemini(
    model: str,
    system_prompt: str,
    user_prompt: str,
) -> dict:
    """Call Gemini API asynchronously.

    Args:
        model: Gemini API model ID (e.g. "gemini-3-flash-preview")
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
    logger.info(f"[GEMINI] Calling model={model}, prompt_len={len(user_prompt)}")

    try:
        result = await asyncio.to_thread(
            _sync_call_gemini, model, system_prompt, user_prompt
        )
        logger.info(
            f"[GEMINI] Response: {result['input_tokens']} in, "
            f"{result['output_tokens']} out, ${result['cost_usd']:.6f}"
        )
        return result

    except Exception as e:
        logger.error(f"[GEMINI] API call failed: {e}")
        raise
