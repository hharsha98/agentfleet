"""Bug 2 (Wave 1): both app.providers.get_llm_client() branches (plain
AsyncOpenAI and the Langfuse-traced client) must carry a timeout and a
retry cap — previously neither had either, on the hottest path in the app.

Hermetic: no real network call. Just inspects the constructed client's
underlying httpx client / retry setting, which the openai SDK exposes as
`._client.timeout` / `.max_retries`.
"""

import httpx

from app.config import get_settings
from app.providers import get_llm_client


def test_plain_client_has_asymmetric_timeout_and_low_retry_cap(monkeypatch) -> None:
    """No Langfuse keys configured -> the plain AsyncOpenAI branch."""
    monkeypatch.setattr(get_settings(), "langfuse_public_key", "")
    monkeypatch.setattr(get_settings(), "langfuse_secret_key", "")

    client = get_llm_client()
    settings = get_settings()

    timeout = client._client.timeout
    assert isinstance(timeout, httpx.Timeout)
    assert timeout.connect == settings.llm_connect_timeout_seconds
    assert timeout.read == settings.llm_read_timeout_seconds
    # Asymmetric: read must be generous relative to connect, per the bug.
    assert timeout.read > timeout.connect

    assert client.max_retries == settings.llm_max_retries
    assert client.max_retries <= 2, "SDK retries must stay low — self-heal owns semantic retries"


def test_read_timeout_stays_under_cloud_run_request_timeout() -> None:
    """The coupling called out in the bug: `read` must stay under Cloud
    Run's default request timeout (300s), or Cloud Run kills the request
    before this timeout ever gets a chance to fire."""
    settings = get_settings()
    cloud_run_default_request_timeout = 300
    assert settings.llm_read_timeout_seconds < cloud_run_default_request_timeout


def test_langfuse_traced_client_also_has_timeout_and_retry_cap(monkeypatch) -> None:
    """The Langfuse-traced branch has the identical hole per the bug report
    ('the Langfuse-traced client has the identical hole') — must not be
    skipped just because it's a different SDK subclass."""
    settings = get_settings()
    monkeypatch.setattr(settings, "langfuse_public_key", "pk-test")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk-test")

    import app.providers as providers_module

    monkeypatch.setattr(providers_module, "get_settings", lambda: settings)

    client = get_llm_client()

    timeout = client._client.timeout
    assert isinstance(timeout, httpx.Timeout)
    assert timeout.connect == settings.llm_connect_timeout_seconds
    assert timeout.read == settings.llm_read_timeout_seconds
    assert client.max_retries == settings.llm_max_retries
