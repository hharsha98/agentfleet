"""LLM provider abstraction.

Dev/testing rides the freellmapi proxy (OpenAI-compatible endpoint over
free-tier providers). Demos switch to a paid provider purely via env —
no code changes. See ARCHITECTURE.md ADR-005.
"""

from openai import AsyncOpenAI

from app.config import get_settings


def get_llm_client() -> AsyncOpenAI:
    settings = get_settings()
    return AsyncOpenAI(
        base_url=settings.free_llm_base_url,
        api_key=settings.free_llm_key,
    )
