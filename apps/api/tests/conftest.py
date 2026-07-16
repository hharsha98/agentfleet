"""Session-wide test setup (Phase 12 B): every route now requires a valid
Bearer JWT except /health, /api/v1/hooks/{id}, and /api/v1/public/* (see
app/auth.py). Existing tests predate auth and call the API with no token at
all — rather than touch every one of ~20 test files individually, this
conftest does two things:

1. Sets AUTH_SECRET in os.environ BEFORE anything imports app.config.
   app.config.get_settings() is @lru_cache'd, so whichever test module
   happens to import app.main first "locks in" the settings for the whole
   session. pytest always fully imports conftest.py before collecting/
   importing sibling test_*.py files in the same directory, so this line
   runs first regardless of test order or which file imports app.main
   first.

2. Monkeypatches httpx.AsyncClient and fastapi.testclient.TestClient (the
   two client classes every existing test constructs directly — there is
   no shared fixture/factory to hook into) so every new instance defaults
   to Authorization: Bearer <valid test JWT> unless the caller already
   passed its own `headers=` (per-call headers always win over client
   defaults in httpx's merge, so e.g. test_webhooks.py's hooks-trigger
   calls — which pass their own webhook-secret Authorization header —
   are unaffected).

Both patches are plain module-attribute reassignment (not a pytest
fixture), because they must be visible to `from httpx import AsyncClient`
/ `from fastapi.testclient import TestClient` statements inside test
modules that haven't been imported yet when conftest.py runs. This has no
effect on production code — nothing under app/ imports httpx.AsyncClient
or TestClient this way.
"""

import datetime as _dt
import os

# Must happen before ANY app.* import in this process — see module
# docstring point 1.
os.environ.setdefault("AUTH_SECRET", "test-secret-for-ci")

import fastapi.testclient
import httpx
import jwt

TEST_AUTH_SECRET = os.environ["AUTH_SECRET"]
DEFAULT_TEST_EMAIL = "test-user@agentfleet.test"


def mint_token(
    email: str = DEFAULT_TEST_EMAIL,
    *,
    secret: str = TEST_AUTH_SECRET,
    name: str | None = None,
    exp_delta: _dt.timedelta = _dt.timedelta(hours=1),
    algorithm: str = "HS256",
) -> str:
    """Mint a JWT with the claims shape app/auth.py expects:
    {sub, email, [name], iat, exp}. Used both by the default-header
    monkeypatch below and directly by tests/test_auth.py (pass a negative
    exp_delta for an already-expired token, or a different secret for a
    bad-signature token).
    """
    now = _dt.datetime.now(_dt.timezone.utc)
    payload: dict = {
        "sub": email,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + exp_delta).timestamp()),
    }
    if name is not None:
        payload["name"] = name
    return jwt.encode(payload, secret, algorithm=algorithm)


_DEFAULT_TOKEN = mint_token()
_DEFAULT_AUTH_HEADER = {"Authorization": f"Bearer {_DEFAULT_TOKEN}"}

_OriginalAsyncClient = httpx.AsyncClient
_OriginalTestClient = fastapi.testclient.TestClient

# Public alias for tests/test_auth.py: the real (unpatched) httpx.AsyncClient,
# for the few tests that need to send NO Authorization header at all (or a
# deliberately bad one) — the patched default-header client below always
# adds one, and there's no reliable way to "unset" a client-level default
# header per-request, so those tests construct this instead.
RawAsyncClient = _OriginalAsyncClient


class _AuthDefaultAsyncClient(_OriginalAsyncClient):
    """httpx.AsyncClient that defaults Authorization to a valid test JWT.
    Caller-supplied headers (e.g. client.post(..., headers={...})) win —
    httpx merges client-level default headers under per-request headers,
    and here we also let an explicit `headers=` kwarg on construction
    override our default for the same reason."""

    def __init__(self, *args, **kwargs):
        headers = {**_DEFAULT_AUTH_HEADER, **(kwargs.pop("headers", None) or {})}
        kwargs["headers"] = headers
        super().__init__(*args, **kwargs)


class _AuthDefaultTestClient(_OriginalTestClient):
    def __init__(self, *args, **kwargs):
        headers = {**_DEFAULT_AUTH_HEADER, **(kwargs.pop("headers", None) or {})}
        kwargs["headers"] = headers
        super().__init__(*args, **kwargs)


httpx.AsyncClient = _AuthDefaultAsyncClient
fastapi.testclient.TestClient = _AuthDefaultTestClient
