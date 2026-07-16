"""Tests for the Voice agent config endpoint (Phase 10 N).

GET /api/v1/voice/config is a pure config-gate: no network call, no Vapi key
required, so these tests run fully offline (CI has no Vapi credentials).
Same monkeypatch-the-settings-object pattern as test_integrations.py
(get_settings() is lru_cache'd, so mutating its returned instance's
attribute is how tests flip a "configured" flag without needing a real key).
"""

from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import app


async def test_voice_config_disabled_by_default() -> None:
    """No VAPI_PUBLIC_KEY in this environment -> disabled, and nothing else
    is present in the response (no leaked assistant config)."""
    settings = get_settings()
    assert settings.vapi_public_key == ""  # sanity: matches the real, key-less env

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/voice/config")
        assert res.status_code == 200, res.text
        assert res.json() == {"enabled": False}


async def test_voice_config_enabled_shape(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "vapi_public_key", "pk_test_123")
    monkeypatch.setattr(settings, "vapi_api_key", "sk_test_secret_should_never_leak")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/voice/config")
        assert res.status_code == 200, res.text
        body = res.json()

        assert body["enabled"] is True
        assert body["public_key"] == "pk_test_123"

        assistant = body["assistant"]
        assert assistant["name"] == "AgentFleet Voice"
        assert isinstance(assistant["firstMessage"], str) and assistant["firstMessage"]
        assert assistant["model"]["provider"] == "openai"
        assert assistant["model"]["model"] == "gpt-4o-mini"
        assert assistant["model"]["messages"][0]["role"] == "system"
        assert "AgentFleet" in assistant["model"]["messages"][0]["content"]
        assert assistant["voice"] == {"provider": "vapi", "voiceId": "Elliot"}


async def test_voice_config_never_leaks_api_key(monkeypatch) -> None:
    """The secret vapi_api_key must never appear anywhere in the response,
    whether enabled or disabled."""
    settings = get_settings()
    monkeypatch.setattr(settings, "vapi_api_key", "sk_super_secret_do_not_leak")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # disabled path (public key still blank)
        res_disabled = await client.get("/api/v1/voice/config")
        assert "sk_super_secret_do_not_leak" not in res_disabled.text

        # enabled path
        monkeypatch.setattr(settings, "vapi_public_key", "pk_test_456")
        res_enabled = await client.get("/api/v1/voice/config")
        assert "sk_super_secret_do_not_leak" not in res_enabled.text
        assert "api_key" not in res_enabled.json()
