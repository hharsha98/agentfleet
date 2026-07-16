"""Tests for Sentry error-monitoring wiring (Phase 11 P).

No Sentry DSN exists in this environment (dev or CI) — every test here runs
fully offline. sentry_sdk.init() does not synchronously contact the network
(events only reach a background worker once actually captured), so even
the "DSN configured" test makes no real network call. Same
monkeypatch-the-settings-object pattern as test_voice.py.
"""

import sentry_sdk

from app.config import get_settings
from app.logging_config import request_id_var
from app.observability import attach_request_id, init_sentry

DUMMY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0"


def test_init_sentry_noop_when_dsn_blank() -> None:
    """No SENTRY_DSN in this environment -> init_sentry() is a no-op and
    sentry_sdk stays on its default NonRecordingClient."""
    settings = get_settings()
    assert settings.sentry_dsn == ""  # sanity: matches the real, key-less env

    assert init_sentry() is False
    assert sentry_sdk.get_client().is_active() is False


def test_init_sentry_activates_client_with_dsn(monkeypatch) -> None:
    """A configured DSN (dummy, well-formed but undeliverable) activates
    the client and returns True. Teardown closes the client and restores
    the no-op client so later tests see the default disabled state again."""
    settings = get_settings()
    monkeypatch.setattr(settings, "sentry_dsn", DUMMY_DSN)

    try:
        assert init_sentry() is True
        client = sentry_sdk.get_client()
        assert client.is_active() is True
    finally:
        client.close(timeout=0)
        sentry_sdk.get_global_scope().set_client(sentry_sdk.client.NonRecordingClient())


def test_attach_request_id_tags_event_when_request_in_flight() -> None:
    token = request_id_var.set("req-abc123")
    try:
        event = {"message": "boom"}
        result = attach_request_id(event, {})
        assert result is not None
        assert result["tags"]["request_id"] == "req-abc123"
    finally:
        request_id_var.reset(token)


def test_attach_request_id_no_tag_outside_request() -> None:
    """Default request_id_var value ("-") means no tag is added — this hook
    also runs for background-job events, where there's no HTTP request."""
    assert request_id_var.get() == "-"  # sanity: no request in flight

    event = {"message": "background job failed"}
    result = attach_request_id(event, {})
    assert result is not None
    assert "request_id" not in result.get("tags", {})


def test_attach_request_id_preserves_existing_tags() -> None:
    token = request_id_var.set("req-xyz789")
    try:
        event = {"message": "boom", "tags": {"existing": "tag"}}
        result = attach_request_id(event, {})
        assert result["tags"] == {"existing": "tag", "request_id": "req-xyz789"}
    finally:
        request_id_var.reset(token)
