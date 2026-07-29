"""Regression tests for provider content-block handling.

A real workflow run failed because a provider behind the OpenAI-compatible
gateway streamed `delta.content` as a LIST of content blocks rather than the
string the wire format documents. That one shape broke the run in two
places: `"".join(parts)` raised "sequence item 0: expected str instance,
list found", and the orchestrator's `text += event["content"]` raised "can
only concatenate str (not 'list') to str". Neither was retryable — every
attempt met the same provider response — so the task died and its dependents
were skipped.

Hermetic: no database, no network, no model.
"""

import asyncio
import json

from app.services.chat import _content_text


def test_plain_string_is_unchanged() -> None:
    assert _content_text("hello") == "hello"
    assert _content_text("") == ""


def test_anthropic_style_blocks_are_flattened() -> None:
    blocks = [{"type": "text", "text": "Hello "}, {"type": "text", "text": "world"}]
    assert _content_text(blocks) == "Hello world"


def test_bare_strings_in_a_list_are_joined() -> None:
    assert _content_text(["a", "b"]) == "ab"


def test_unknown_blocks_contribute_nothing() -> None:
    # A stray repr like "{'type': 'thinking'}" inside the user's answer is
    # worse than dropping the block entirely.
    assert _content_text([{"type": "thinking"}, {"type": "text", "text": "kept"}]) == "kept"


def test_none_and_unexpected_types_are_empty_not_crashes() -> None:
    assert _content_text(None) == ""
    assert _content_text(123) == ""


def test_orchestrator_survives_a_list_valued_token_event() -> None:
    """The consumer side of the same bug: even if another runtime emits a
    non-string token, accumulating it must not raise — a crash there cannot
    be healed by retrying, since the next attempt sees the same shape."""
    from app.services import orchestrator

    async def fake_stream(conversation_id, prompt):
        yield "data: " + json.dumps({"type": "token", "content": [{"text": "ok"}]})
        yield "data: " + json.dumps(
            {"type": "done", "usage": {"tokens_in": 1, "tokens_out": 1}}
        )

    original = orchestrator.stream_chat
    orchestrator.stream_chat = fake_stream
    try:
        # _run_turn now returns a 4th value, `evidence` (rich failure
        # context for classify_failure/the repair prompt — see Layer 1's
        # rich-evidence capture); empty on a successful turn like this one.
        text, usage, error, evidence = asyncio.run(orchestrator._run_turn("cid", "prompt"))
    finally:
        orchestrator.stream_chat = original

    assert error is None, f"a list-valued token must not fail the turn: {error}"
    assert usage.get("tokens_in") == 1
    assert evidence == {}
