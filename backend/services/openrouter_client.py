"""
OpenRouter Client — lightweight wrapper for delegating tasks to Claude subagents
via OpenRouter when Clyde is running in OpenRouter mode.

Handles API calls, token counting, and cost calculation.
Subagents are tool-free (prompt-in/text-out only), matching the pattern
used by gemini_client.py and openai_client.py.
"""

import asyncio
import logging
import os
from typing import Any

import httpx

from services.settings import OPENROUTER_PRICING

logger = logging.getLogger(__name__)


def _calculate_cost(
    model: str, input_tokens: int, output_tokens: int
) -> float:
    """Calculate USD cost from token counts and model pricing."""
    pricing = OPENROUTER_PRICING.get(model)
    if pricing is None:
        logger.warning(f"[OPENROUTER] No pricing found for model {model}, using 0 cost")
        return 0.0

    input_rate, output_rate = pricing
    cost = (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
    return round(cost, 6)


async def call_openrouter(
    model: str,
    system_prompt: str,
    user_prompt: str,
) -> dict[str, Any]:
    """Call OpenRouter API for a tool-free subagent task.

    Args:
        model: OpenRouter model ID (e.g. "anthropic/claude-sonnet-4")
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
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set. Add it in Settings or .env.local."
        )

    logger.info(f"[OPENROUTER] Calling model={model}, prompt_len={len(user_prompt)}")

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
            },
        )
        if response.status_code != 200:
            body = response.text
            logger.error(
                f"[OPENROUTER] API error {response.status_code}: {body}"
            )
            raise RuntimeError(
                f"OpenRouter API returned {response.status_code}: {body}"
            )
        data = response.json()

    # Extract content
    content = ""
    choices = data.get("choices", [])
    if choices:
        content = choices[0].get("message", {}).get("content", "")

    # Extract token counts
    usage = data.get("usage", {})
    input_tokens = usage.get("prompt_tokens", 0)
    output_tokens = usage.get("completion_tokens", 0)

    # OpenRouter may return actual cost in usage
    actual_cost = usage.get("cost")
    if actual_cost is not None:
        cost_usd = round(float(actual_cost), 6)
    else:
        cost_usd = _calculate_cost(model, input_tokens, output_tokens)

    logger.info(
        f"[OPENROUTER] Response: {input_tokens} in, "
        f"{output_tokens} out, ${cost_usd:.6f}"
    )

    return {
        "content": content,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": cost_usd,
        "model": model,
    }
