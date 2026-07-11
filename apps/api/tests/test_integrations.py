"""Tests for the Phase 10 integration tools: send_slack (Slack) and
push_to_crm (HubSpot).

Both tools must degrade gracefully when their env var isn't set — return a
clear "not configured" message instead of raising or making a network call.
These tests run entirely offline: the not-configured path never calls out,
so no live Slack/HubSpot access is needed (and none is exercised here).
"""

import asyncio
import json

from app.config import get_settings
from app.tools import TOOLS, run_tool, specs_for


def test_specs_for_includes_send_slack_and_push_to_crm() -> None:
    specs = specs_for(["send_slack", "push_to_crm", "not_a_tool"])
    assert specs == [TOOLS["send_slack"]["spec"], TOOLS["push_to_crm"]["spec"]]


def test_send_slack_not_configured_returns_graceful_message(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "slack_webhook_url", "")

    result = asyncio.run(run_tool("send_slack", {"message": "hello team"}))

    assert result.startswith("Slack is not configured")
    assert "SLACK_WEBHOOK_URL" in result
    assert "hello team" in result


def test_push_to_crm_not_configured_returns_graceful_message(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "hubspot_access_token", "")

    contact = {"name": "Jane Doe", "email": "jane@acme.com", "company": "Acme Corp"}
    result = asyncio.run(run_tool("push_to_crm", {"contact_json": json.dumps(contact)}))

    assert result.startswith("CRM is not configured")
    assert "HUBSPOT_ACCESS_TOKEN" in result
    assert "Jane Doe" in result
    assert "Acme Corp" in result


def test_push_to_crm_invalid_json_is_safe(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "hubspot_access_token", "")

    result = asyncio.run(run_tool("push_to_crm", {"contact_json": "not json"}))

    assert result == "Invalid contact JSON"
