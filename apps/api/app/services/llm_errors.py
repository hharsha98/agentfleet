"""Plain-English wording for model-provider failures, shared by every agent
runtime (chat.py, graph_runtime.py, pydantic_runtime.py) and the mission
planner (orchestrator.py).

Two constraints shape every message:

* The raw provider exception text never reaches a visitor: it can embed key
  fragments and internal URLs. Only the exception CLASS name does, exactly
  as before this module existed.
* services/orchestrator.py::classify_failure routes mission retries by
  keyword-matching the error string, and keys on that class name
  ("apiconnectionerror", "ratelimit", "authenticationerror", ...). So each
  message still ENDS with "(<ClassName>)"; only the sentence in front of it
  got friendlier. tests/test_llm_errors.py pins that the label every
  exception gets is unchanged.
"""

import asyncio

import openai

from app.config import get_settings

# The phrase "ai provider is not configured" is also a capability keyword in
# orchestrator.classify_failure: a mission stops at once instead of
# self-healing for minutes against a provider that was never set up.
NOT_CONFIGURED_MESSAGE = (
    "The AI provider is not configured on this server (FREE_LLM_BASE_URL is empty), "
    "so agents can't answer yet. If you run this instance, set FREE_LLM_BASE_URL and "
    "FREE_LLM_KEY for the API and restart it (see docs/DEPLOY.md)."
)


def llm_unconfigured_message() -> str | None:
    """The message to show instead of calling the provider, or None when an
    endpoint is configured. A missing KEY alone is not treated as fatal here:
    local OpenAI-compatible servers accept none, and a provider that needs
    one answers 401, which provider_error_message explains."""
    return None if get_settings().llm_configured else NOT_CONFIGURED_MESSAGE


_LEADS = {
    "auth": "The AI provider rejected this server's API key. If you run this instance, check FREE_LLM_KEY.",
    "permission": "The AI provider refused this request for this key or model.",
    "rate_limit": "The AI provider is rate-limiting requests right now. Wait a minute, then try again.",
    "timeout": "The AI provider took too long to answer. Please try again.",
    "connection": "Couldn't reach the AI provider. Please try again in a moment.",
    "server": "The AI provider had a temporary server error. Please try again in a moment.",
    "bad_request": "The AI provider rejected the request.",
}


def _kind(exc: BaseException) -> str | None:
    # Order matters: APITimeoutError subclasses APIConnectionError.
    if isinstance(exc, openai.AuthenticationError):
        return "auth"
    if isinstance(exc, openai.PermissionDeniedError):
        return "permission"
    if isinstance(exc, openai.RateLimitError):
        return "rate_limit"
    if isinstance(exc, openai.NotFoundError):
        return "not_found"
    if isinstance(exc, (openai.APITimeoutError, asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    if isinstance(exc, openai.APIConnectionError):
        return "connection"
    if isinstance(exc, openai.InternalServerError):
        return "server"
    if isinstance(exc, openai.BadRequestError):
        return "bad_request"
    # Other SDKs (e.g. Pydantic AI's ModelHTTPError) expose the HTTP status.
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        if status == 401:
            return "auth"
        if status == 403:
            return "permission"
        if status == 404:
            return "not_found"
        if status == 429:
            return "rate_limit"
        if 500 <= status < 600:
            return "server"
        if status in (400, 422):
            return "bad_request"
    return None


def provider_error_message(exc: BaseException, model: str | None = None) -> str:
    """A visitor-safe, plain-English sentence for a provider failure, always
    ending in "(<ExceptionClass>)" so failure classification is unchanged."""
    name = type(exc).__name__
    kind = _kind(exc)
    if kind is None:
        return f"The model provider returned an error ({name}). Please try again."
    if kind == "not_found":
        which = f" '{model}'" if model else ""
        lead = (
            f"The AI provider doesn't offer the model{which}. If you run this instance, "
            "set DEFAULT_MODEL to a model your provider lists."
        )
    else:
        lead = _LEADS[kind]
    return f"{lead} ({name})"
