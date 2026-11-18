"""LLM provider abstraction.

Dev/testing rides the freellmapi proxy (OpenAI-compatible endpoint over
free-tier providers). Demos switch to a paid provider purely via env —
no code changes. See ARCHITECTURE.md ADR-005.
"""

import os

from openai import AsyncOpenAI, Timeout

from app.config import get_settings


def _client_timeout_kwargs(settings) -> dict:
    """Shared timeout/retry config for both client branches below (Bug 2,
    Wave 1). Neither branch had a timeout or a retry cap before — this is
    the hottest path in the app, so an unresponsive free-tier endpoint
    could hang a request forever.

    Asymmetric timeout: `connect` fails fast (~5s — a dead endpoint
    has no legitimate reason to take longer to refuse a TCP handshake),
    `read` is generous (~120s — a large model streaming a long completion
    can genuinely run past a minute) but MUST stay under Cloud Run's
    request timeout (default 300s, Wave 4's eventual deploy target): if
    Cloud Run kills the request first, this timeout never gets the chance
    to fire at all. See app/config.py for the exact values and reasoning.

    Built with the openai SDK's own `Timeout` export, not `httpx.Timeout`:
    the SDK re-exports the Timeout of whichever HTTP library it is built on
    (httpx in openai 2.x, httpx2 in 3.x), so this stays the type the client
    expects across that switch. Handed an `httpx.Timeout`, openai 3 left its
    HTTP client's default timeout holding a Timeout object in each of
    connect/read/write/pool instead of a number.

    max_retries is deliberately LOW: app.services.orchestrator's self-heal
    ladder (SELF_HEAL_* settings, see config.py) already retries failures
    *semantically* — a new prompt, an escalated model — on top of whatever
    happens here. Letting the SDK also retry heavily would let a transport
    hiccup compound into a multi-minute stall right as the self-heal
    deadline is already ticking, so the SDK is only trusted to own bare
    transport failures (dropped connection, a bare 5xx), never anything
    semantic.

    Known gap, not worth engineering around here: a stream that connects
    and then trickles bytes very slowly evades `read` entirely, because
    the HTTP client resets the read-timeout clock on every chunk received. Catching
    that needs an application-level "no progress in N seconds" watchdog
    around the stream consumer, not a client constructor kwarg.
    """
    timeout = Timeout(
        connect=settings.llm_connect_timeout_seconds,
        read=settings.llm_read_timeout_seconds,
        write=settings.llm_write_timeout_seconds,
        pool=settings.llm_pool_timeout_seconds,
    )
    return {"timeout": timeout, "max_retries": settings.llm_max_retries}


def get_llm_client() -> AsyncOpenAI:
    settings = get_settings()
    client_kwargs = _client_timeout_kwargs(settings)
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
            **client_kwargs,
        )
    return AsyncOpenAI(
        base_url=settings.free_llm_base_url,
        api_key=settings.free_llm_key,
        **client_kwargs,
    )
