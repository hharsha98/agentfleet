"""LLM provider abstraction.

Dev/testing rides the freellmapi proxy (OpenAI-compatible endpoint over
free-tier providers). Demos switch to a paid provider purely via env —
no code changes. See ARCHITECTURE.md ADR-005.
"""

import os

from openai import AsyncOpenAI

from app.config import get_settings


def get_llm_client() -> AsyncOpenAI:
    settings = get_settings()
    if settings.langfuse_public_key and settings.langfuse_secret_key:
        # The Langfuse drop-in wrapper reads credentials from process env;
        # pydantic loads .env into settings only, so mirror them across.
        os.environ.setdefault("LANGFUSE_PUBLIC_KEY", settings.langfuse_public_key)
        os.environ.setdefault("LANGFUSE_SECRET_KEY", settings.langfuse_secret_key)
        os.environ.setdefault("LANGFUSE_HOST", settings.langfuse_host)
        from langfuse.openai import AsyncOpenAI as TracedAsyncOpenAI

        return TracedAsyncOpenAI(
            base_url=settings.free_llm_base_url,
            api_key=settings.free_llm_key,
        )
    return AsyncOpenAI(
        base_url=settings.free_llm_base_url,
        api_key=settings.free_llm_key,
    )
