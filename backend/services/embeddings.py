import os
from openai import OpenAI

_client: OpenAI | None = None

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536


def get_openai_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if api_key:
            _client = OpenAI(api_key=api_key)
        else:
            # Fall back to OpenRouter for embeddings when no direct OpenAI key
            openrouter_key = os.environ.get("OPENROUTER_API_KEY")
            if openrouter_key:
                _client = OpenAI(
                    api_key=openrouter_key,
                    base_url="https://openrouter.ai/api/v1",
                    default_headers={
                        "HTTP-Referer": "https://projectclyde.app",
                        "X-OpenRouter-Title": "Project Clyde",
                    },
                )
            else:
                raise RuntimeError(
                    "No OPENAI_API_KEY or OPENROUTER_API_KEY found for embeddings"
                )
    return _client


async def generate_embedding(text: str) -> list[float]:
    """Generate embedding for document storage."""
    client = get_openai_client()
    response = client.embeddings.create(input=[text], model=EMBEDDING_MODEL)
    return response.data[0].embedding


async def generate_query_embedding(text: str) -> list[float]:
    """Generate embedding for search queries.

    Note: Unlike Voyage AI, OpenAI text-embedding-3-small uses the same
    embedding for both documents and queries — no separate input_type needed.
    """
    return await generate_embedding(text)
