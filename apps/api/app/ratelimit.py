"""Per-user (else per-IP) rate limiting (Phase 12 C): slowapi + `limits`,
applied only to the endpoints worth protecting from abuse — chat send,
document upload, and the public agent-invoke endpoint (app/routes/chat.py,
documents.py, public.py). Everything else (list/read endpoints, CRUD on
agents/conversations/etc.) stays unlimited; those are cheap DB reads/writes,
not the resource this guards (LLM token spend + upload storage).

Key function: the verified JWT's `email` claim (reusing app.auth.decode_token
— a pure decode, no DB hit) when a Bearer token is present and valid;
otherwise the caller's IP. The public invoke endpoint authenticates with an
opaque API key, not a JWT, so decode_token raises and it falls through to
per-IP — that's intentional, matching the locked design ("invalid/absent
token -> fall back to client IP").

Storage: Redis (`settings.redis_url`) when reachable at process startup,
else `limits`' in-memory backend — logged once so it's obvious which one is
live (CI has no Redis service; local dev / prod do). RATE_LIMIT_DISABLED=1
sets `limiter.enabled = False` and every check becomes a no-op (used by the
test suite by default, and available for local dev freedom).

Per-route limits are passed to `@limiter.limit(...)` as CALLABLES
(chat_limit / upload_limit / public_limit below), not plain strings. slowapi
bakes a plain-string limit_value in permanently at decoration time (module
import), which would make it impossible for tests to exercise a tiny limit
via monkeypatched Settings. A callable is re-evaluated on every request, so
`monkeypatch.setattr(settings_instance, "rate_limit_chat", "2/minute")`
takes effect immediately (see tests/test_ratelimit.py).

SSE / non-Response-return finding (see docs/PRODUCTION_PLAN.md Phase 12 C):
slowapi's `Limiter(headers_enabled=True)` writes X-RateLimit-*/Retry-After
headers on every decorated response by calling `response.headers[...]` — but
for a route whose return value isn't a Response instance and doesn't declare
a `response: Response` parameter (documents.py's dict return, public.py's
dict return), slowapi's own header-injection code path raises an internal
Exception (it has nothing to attach headers to), turning every SUCCESSFUL
call into a 500. StreamingResponse (chat.py's return type) IS a Response
instance so it's unaffected — the landmine is specific to the two
dict-returning routes. Fix: headers_enabled is left at its default (False)
globally, so slowapi never touches response headers on the success path for
any route; Retry-After is instead added by hand in main.py's exception
handler for the 429 case only (RATE_LIMIT_DISABLED bypass and the 3
decorated routes were live-tested with this configuration — see the
verification section of the phase report).
"""

import logging

import redis as redis_sync
from fastapi import Request
from slowapi import Limiter

from app.auth import AuthError, decode_token
from app.config import get_settings

logger = logging.getLogger("app.ratelimit")

# X-Forwarded-For is trivially spoofable by anyone who can reach the API
# directly — only trust it when the API sits behind a reverse proxy that
# OVERWRITES (not appends to) the header before forwarding. No such proxy
# is confirmed in this deployment yet, so this stays off; flip to True (and
# add proper trusted-hop validation) once one is.
TRUST_PROXY_HEADERS = False


def rate_limit_key(request: Request) -> str:
    """slowapi key_func: per-user via the verified JWT's email claim, else
    per-IP. A present-but-invalid/foreign token (e.g. the public invoke
    endpoint's API key, which isn't a JWT at all) falls through to IP
    rather than erroring — rate limiting must never be the thing that
    breaks a request auth itself already accepts or rejects."""
    authorization = request.headers.get("Authorization")
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        if token:
            try:
                payload = decode_token(token)
                return f"user:{payload['email'].strip().lower()}"
            except AuthError:
                pass  # not a JWT we can verify -> fall through to IP below

    if TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return f"ip:{forwarded.split(',')[0].strip()}"
    client = request.client
    return f"ip:{client.host if client else 'unknown'}"


def _select_storage_uri() -> str:
    """One-shot reachability check at import time (process startup), not a
    per-request health check. Redis down/unset -> in-memory storage, which
    is also what makes the endpoints work at all in CI (no Redis service
    there — see .github/workflows/evals.yml)."""
    settings = get_settings()
    try:
        client = redis_sync.from_url(settings.redis_url, socket_connect_timeout=0.5)
        client.ping()
        client.close()
        logger.info("rate limit storage: redis (%s)", settings.redis_url)
        return settings.redis_url
    except Exception:
        logger.info("rate limit storage: in-memory (redis unreachable at startup)")
        return "memory://"


def chat_limit() -> str:
    return get_settings().rate_limit_chat


def upload_limit() -> str:
    return get_settings().rate_limit_upload


def public_limit() -> str:
    return get_settings().rate_limit_public


limiter = Limiter(
    key_func=rate_limit_key,
    storage_uri=_select_storage_uri(),
    enabled=not get_settings().rate_limit_disabled,
)
