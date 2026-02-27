import os
from openai import OpenAI

_client: OpenAI | None = None

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536


def get_openai_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
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
