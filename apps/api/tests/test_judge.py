"""Tests for the LLM-as-judge safety gate (services/evals.py::judge and its
pure helpers _coerce_verdict / _first_json_object).

Two bugs under test here:

1. `bool(parsed.get("pass"))` treated any truthy STRING (including the
   literal string "false") as a pass. `{"pass": "false"}` must fail.
2. `text.rfind("}")` grabbed the LAST closing brace in the response, so
   prose appended after a valid JSON object (containing its own `}`) made
   json.loads choke on a correct verdict. The first BALANCED object
   starting from the first `{` must be used instead.

The provider is stubbed throughout (a fake client shaped like
tests/test_orchestrator_self_heal.py's _no_plan_llm_client) — no network.
"""

from types import SimpleNamespace

import pytest

from app.services.evals import _coerce_verdict, _first_json_object, judge


def _fake_llm_client(content: str | None = None, *, raises: Exception | None = None):
    """Fake get_llm_client() whose chat.completions.create() returns a canned
    message content, or raises `raises` if given. Same shape as
    test_orchestrator_self_heal.py's _no_plan_llm_client."""

    class _FakeCompletions:
        async def create(self, **kwargs):
            if raises is not None:
                raise raises
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
            )

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    return _FakeClient()


# --- _coerce_verdict: pure, no provider involved ---------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        (True, True),
        (False, False),
        ("false", False),  # the regression case: a truthy Python string
        ("no", False),
        (0, False),
        ("FALSE", False),
        ("yes", True),
        (1, True),
        ("true", True),
        ("pass", True),
        ("fail", False),
        ("  TRUE  ", True),  # whitespace-stripped
        ("banana", None),
        (None, None),
        (2, None),
        (3.5, None),
        ([], None),
    ],
)
def test_coerce_verdict(raw, expected) -> None:
    assert _coerce_verdict(raw) is expected


# --- _first_json_object: pure, no provider involved ------------------------


def test_first_json_object_plain() -> None:
    assert _first_json_object('{"pass": true}') == '{"pass": true}'


def test_first_json_object_wrapped_in_prose() -> None:
    text = 'Sure thing! {"pass": true, "reason": "ok"} Hope that helps.'
    assert _first_json_object(text) == '{"pass": true, "reason": "ok"}'


def test_first_json_object_prose_after_containing_brace() -> None:
    # The rfind() regression: a brace appears AFTER the JSON object.
    text = '{"pass": true, "reason": "ok"} (rubric said {strict})'
    assert _first_json_object(text) == '{"pass": true, "reason": "ok"}'


def test_first_json_object_string_value_contains_braces() -> None:
    text = '{"reason": "use {curly} braces", "pass": false}'
    assert _first_json_object(text) == text


def test_first_json_object_escaped_quote_in_string() -> None:
    text = '{"reason": "she said \\"hi\\"", "pass": true}'
    assert _first_json_object(text) == text


def test_first_json_object_no_json_at_all() -> None:
    assert _first_json_object("no json here") is None


def test_first_json_object_unbalanced() -> None:
    assert _first_json_object('{"pass": true') is None


# --- judge(): end-to-end with a stubbed provider ---------------------------


@pytest.mark.parametrize(
    "content,expected_pass,expected_reason",
    [
        ('{"pass": true, "reason": "good"}', True, "good"),
        ('{"pass": false, "reason": "bad"}', False, "bad"),
        ('{"pass": "false", "reason": "bad"}', False, "bad"),  # THE regression test
        ('{"pass": "no", "reason": "bad"}', False, "bad"),
        ('{"pass": 0, "reason": "bad"}', False, "bad"),
        ('{"pass": "FALSE", "reason": "bad"}', False, "bad"),
        ('{"pass": "yes", "reason": "good"}', True, "good"),
        ('{"pass": 1, "reason": "good"}', True, "good"),
    ],
)
async def test_judge_verdict_coercion(monkeypatch, content, expected_pass, expected_reason) -> None:
    monkeypatch.setattr(
        "app.services.evals.get_llm_client", lambda: _fake_llm_client(content)
    )
    passed, reason = await judge("rubric", "input", "reply", "test-model")
    assert passed is expected_pass
    assert reason == expected_reason


@pytest.mark.parametrize(
    "content",
    [
        '{"pass": "banana", "reason": "?"}',
        '{"reason": "no pass key at all"}',  # missing key
        '{"pass": null, "reason": "?"}',
    ],
)
async def test_judge_unparseable_verdict_fails_closed(monkeypatch, content) -> None:
    monkeypatch.setattr(
        "app.services.evals.get_llm_client", lambda: _fake_llm_client(content)
    )
    passed, reason = await judge("rubric", "input", "reply", "test-model")
    assert passed is False
    assert "judge error" in reason


async def test_judge_prose_wrapped_json(monkeypatch) -> None:
    content = 'Here is my verdict: {"pass": true, "reason": "solid"} — hope that helps!'
    monkeypatch.setattr(
        "app.services.evals.get_llm_client", lambda: _fake_llm_client(content)
    )
    passed, reason = await judge("rubric", "input", "reply", "test-model")
    assert passed is True
    assert reason == "solid"


async def test_judge_json_followed_by_prose_with_brace(monkeypatch) -> None:
    # The rfind() regression, end-to-end: a CORRECT verdict must not be
    # turned into a failure just because prose after it contains "}".
    content = '{"pass": true, "reason": "solid"} (rubric said {strict})'
    monkeypatch.setattr(
        "app.services.evals.get_llm_client", lambda: _fake_llm_client(content)
    )
    passed, reason = await judge("rubric", "input", "reply", "test-model")
    assert passed is True
    assert reason == "solid"


async def test_judge_string_value_with_braces(monkeypatch) -> None:
    content = '{"reason": "use {curly} braces correctly", "pass": true}'
    monkeypatch.setattr(
        "app.services.evals.get_llm_client", lambda: _fake_llm_client(content)
    )
    passed, reason = await judge("rubric", "input", "reply", "test-model")
    assert passed is True
    assert reason == "use {curly} braces correctly"


async def test_judge_no_json_at_all_fails_closed(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.evals.get_llm_client",
        lambda: _fake_llm_client("I refuse to answer in JSON."),
    )
    passed, reason = await judge("rubric", "input", "reply", "test-model")
    assert passed is False
    assert "no JSON object" in reason


async def test_judge_provider_raises_fails_closed(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.evals.get_llm_client",
        lambda: _fake_llm_client(raises=RuntimeError("provider exploded")),
    )
    passed, reason = await judge("rubric", "input", "reply", "test-model")
    assert passed is False
    assert "judge error" in reason
