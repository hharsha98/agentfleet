"""Tests for scripts/stub_llm.py — the OpenAI-compatible stub that makes the
evals-offline CI gate hermetic (see that module's docstring).

Hermetic in the same sense the app under test is: FastAPI's TestClient
drives the `app` ASGI callable directly, no socket, no subprocess, no real
uvicorn — same pattern the rest of this suite uses for the main app
(tests/test_evals.py et al.), just against a different `app` object.
"""

import json

from fastapi.testclient import TestClient

from scripts.stub_llm import _last_user_message, load_fixtures, select_reply
from scripts.stub_llm import app as stub_app

client = TestClient(stub_app)


# --- /health -----------------------------------------------------------------


def test_health_returns_200() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


# --- fixture loading and rule matching (pure, no HTTP) ------------------------


def test_load_fixtures_loads_the_real_repo_fixtures_file() -> None:
    # No path override -> the default scripts/fixtures/llm_fixtures.json.
    # Exercises the actual shipped file, not a synthetic one, so a broken
    # real fixtures file fails this test rather than only failing at
    # `run_evals` time.
    fixtures = load_fixtures()
    assert isinstance(fixtures["default"], str) and fixtures["default"]
    assert isinstance(fixtures["rules"], list) and len(fixtures["rules"]) > 0
    for rule in fixtures["rules"]:
        assert isinstance(rule["match"], list) and rule["match"]
        assert isinstance(rule["reply"], str) and rule["reply"]


def test_load_fixtures_rejects_malformed_file(tmp_path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"rules": []}))  # missing required "default"
    try:
        load_fixtures(bad)
        raised = False
    except RuntimeError:
        raised = True
    assert raised, "a fixtures file missing 'default' must raise, not silently degrade"


def test_select_reply_matches_first_rule_whose_substrings_all_appear() -> None:
    fixtures = {
        "default": "fallback reply",
        "rules": [
            {"name": "multi", "match": ["alpha", "beta"], "reply": "alpha-and-beta reply"},
            {"name": "single", "match": ["beta"], "reply": "beta-only reply"},
        ],
    }
    # Satisfies both rules' match sets -> the FIRST one in file order wins.
    assert select_reply(fixtures, "Please discuss alpha and beta together.") == (
        "alpha-and-beta reply"
    )
    # Satisfies only the second rule.
    assert select_reply(fixtures, "just beta here") == "beta-only reply"


def test_select_reply_match_is_case_insensitive() -> None:
    fixtures = {"default": "fallback", "rules": [{"match": ["Acme"], "reply": "acme reply"}]}
    assert select_reply(fixtures, "tell me about ACME corp") == "acme reply"
    assert select_reply(fixtures, "tell me about acme corp") == "acme reply"


def test_select_reply_falls_back_to_default_when_no_rule_matches() -> None:
    fixtures = {"default": "fallback reply", "rules": [{"match": ["zzz"], "reply": "never"}]}
    assert select_reply(fixtures, "completely unrelated text") == "fallback reply"


def test_select_reply_requires_ALL_match_substrings_present() -> None:
    fixtures = {
        "default": "fallback",
        "rules": [{"match": ["alpha", "beta"], "reply": "matched"}],
    }
    # Only "alpha" present, not "beta" -> falls through to default.
    assert select_reply(fixtures, "alpha only, no second word") == "fallback"


def test_last_user_message_picks_the_most_recent_user_turn() -> None:
    messages = [
        {"role": "system", "content": "you are a bot"},
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "second question"},
    ]
    assert _last_user_message(messages) == "second question"


def test_last_user_message_handles_content_block_list() -> None:
    # Some OpenAI-compatible providers stream/send content as a list of
    # blocks rather than a plain string — see app/services/chat.py's
    # `_content_text` for the same tolerance on the receiving side.
    messages = [
        {
            "role": "user",
            "content": [{"type": "text", "text": "block one"}, {"type": "text", "text": "two"}],
        }
    ]
    assert _last_user_message(messages) == "block one two"


def test_last_user_message_empty_when_no_user_role_present() -> None:
    assert _last_user_message([{"role": "system", "content": "only system"}]) == ""


# --- POST /v1/chat/completions: non-streaming ---------------------------------


def test_non_streaming_response_shape() -> None:
    res = client.post(
        "/v1/chat/completions",
        json={
            "model": "stub-model",
            "stream": False,
            "messages": [{"role": "user", "content": "unmatched request text"}],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["object"] == "chat.completion"
    assert body["model"] == "stub-model"
    choice = body["choices"][0]
    assert choice["message"]["role"] == "assistant"
    assert isinstance(choice["message"]["content"], str) and choice["message"]["content"]
    assert choice["finish_reason"] == "stop"
    usage = body["usage"]
    assert usage["prompt_tokens"] > 0
    assert usage["completion_tokens"] > 0
    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]


def test_non_streaming_defaults_to_non_streaming_when_stream_key_omitted() -> None:
    # OpenAI's own API defaults `stream` to false when omitted entirely.
    res = client.post(
        "/v1/chat/completions",
        json={"model": "stub-model", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert res.status_code == 200
    assert res.json()["object"] == "chat.completion"


def test_non_streaming_uses_fixture_rule_reply() -> None:
    # "podcast" is a real match phrase in the shipped fixtures file
    # (scripts/fixtures/llm_fixtures.json) for the orchestrator eval case.
    res = client.post(
        "/v1/chat/completions",
        json={
            "model": "stub-model",
            "stream": False,
            "messages": [
                {"role": "user", "content": "Plan a 3-step approach to launch a podcast."}
            ],
        },
    )
    content = res.json()["choices"][0]["message"]["content"]
    assert "1" in content and "2" in content and "3" in content


# --- POST /v1/chat/completions: streaming (the CRITICAL path) -----------------


def _parse_sse_events(raw_text: str) -> list[dict | str]:
    """Split an SSE body into its `data: ...` payloads, parsing each as JSON
    unless it's the literal `[DONE]` sentinel."""
    events: list[dict | str] = []
    for line in raw_text.split("\n\n"):
        line = line.strip()
        if not line:
            continue
        assert line.startswith("data: "), f"malformed SSE line: {line!r}"
        payload = line[len("data: ") :]
        events.append("[DONE]" if payload == "[DONE]" else json.loads(payload))
    return events


def test_streaming_response_is_well_formed_sse_terminated_by_done() -> None:
    res = client.post(
        "/v1/chat/completions",
        json={
            "model": "stub-model",
            "stream": True,
            "stream_options": {"include_usage": True},
            "messages": [{"role": "user", "content": "unmatched request text"}],
        },
    )
    assert res.status_code == 200
    events = _parse_sse_events(res.text)
    assert events[-1] == "[DONE]"

    chunk_events = events[:-1]
    assert all(isinstance(e, dict) for e in chunk_events)
    for chunk in chunk_events:
        assert chunk["object"] == "chat.completion.chunk"
        assert "choices" in chunk


def test_streaming_reassembles_to_the_matched_fixture_reply() -> None:
    res = client.post(
        "/v1/chat/completions",
        json={
            "model": "stub-model",
            "stream": True,
            "messages": [
                {"role": "user", "content": "Plan a 3-step approach to launch a podcast."}
            ],
        },
    )
    events = [e for e in _parse_sse_events(res.text) if e != "[DONE]"]
    text = "".join(
        e["choices"][0]["delta"].get("content", "")
        for e in events
        if e["choices"]  # skip the usage-only chunk, which has an empty choices list
    )
    assert "1" in text and "2" in text and "3" in text


def test_streaming_final_chunk_has_finish_reason_stop() -> None:
    res = client.post(
        "/v1/chat/completions",
        json={
            "model": "stub-model",
            "stream": True,
            "messages": [{"role": "user", "content": "anything"}],
        },
    )
    events = [e for e in _parse_sse_events(res.text) if e != "[DONE]" and e["choices"]]
    finish_reasons = [e["choices"][0]["finish_reason"] for e in events]
    assert "stop" in finish_reasons


def test_streaming_with_include_usage_sends_a_final_usage_only_chunk() -> None:
    # This is the shape app/services/chat.py's
    # `chunk.choices[0].delta if chunk.choices else None` exists to handle —
    # an empty `choices` list on the chunk carrying `usage`.
    res = client.post(
        "/v1/chat/completions",
        json={
            "model": "stub-model",
            "stream": True,
            "stream_options": {"include_usage": True},
            "messages": [{"role": "user", "content": "anything"}],
        },
    )
    events = [e for e in _parse_sse_events(res.text) if e != "[DONE]"]
    usage_chunks = [e for e in events if e["choices"] == [] and "usage" in e]
    assert len(usage_chunks) == 1
    usage = usage_chunks[0]["usage"]
    assert usage["prompt_tokens"] > 0
    assert usage["completion_tokens"] > 0
    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]


def test_streaming_without_include_usage_sends_no_usage_chunk() -> None:
    res = client.post(
        "/v1/chat/completions",
        json={
            "model": "stub-model",
            "stream": True,
            # No stream_options at all — a caller that never asks for usage
            # must not get an extra chunk it didn't request.
            "messages": [{"role": "user", "content": "anything"}],
        },
    )
    events = [e for e in _parse_sse_events(res.text) if e != "[DONE]"]
    assert not any(e["choices"] == [] and "usage" in e for e in events)


def test_streaming_and_non_streaming_agree_on_which_reply_was_selected() -> None:
    body_common = {
        "model": "stub-model",
        "messages": [
            {
                "role": "user",
                "content": (
                    "How many distinct regions appear in analytics_sales? "
                    "Give the exact number."
                ),
            }
        ],
    }
    non_stream = client.post(
        "/v1/chat/completions", json={**body_common, "stream": False}
    ).json()["choices"][0]["message"]["content"]

    stream_res = client.post("/v1/chat/completions", json={**body_common, "stream": True})
    events = [e for e in _parse_sse_events(stream_res.text) if e != "[DONE]" and e["choices"]]
    streamed_text = "".join(e["choices"][0]["delta"].get("content", "") for e in events)

    assert non_stream == streamed_text


# --- deterministic, and doesn't crash on odd input ----------------------------


def test_same_request_produces_identical_response() -> None:
    body = {
        "model": "stub-model",
        "stream": False,
        "messages": [{"role": "user", "content": "determinism check"}],
    }
    first = client.post("/v1/chat/completions", json=body).json()
    second = client.post("/v1/chat/completions", json=body).json()
    assert first == second


def test_missing_messages_key_does_not_crash() -> None:
    res = client.post("/v1/chat/completions", json={"model": "stub-model", "stream": False})
    assert res.status_code == 200
    assert res.json()["choices"][0]["message"]["content"]
