"""Tests for app/costs.py's pricing lookup: exact-match-then-longest-prefix
(not dict-iteration-order), the unpriced-vs-free distinction, the
once-per-model warning, and the PRICES_UPDATED staleness guard.

Pure unit tests -- no DB, no event loop quirks, plain sync `def test_...`
(pyproject.toml sets asyncio_mode = "auto", which only auto-marks async
tests; sync tests run unchanged).
"""

import logging
from datetime import date, timedelta

import app.costs as costs


def test_exact_match_wins_over_any_prefix(monkeypatch) -> None:
    # "foo" is a prefix of "foo-bar" -- an exact match on the full string
    # must win over a shorter prefix entry that also matches.
    monkeypatch.setattr(
        costs, "PRICES", {"foo": (1.0, 1.0, None), "foo-bar": (5.0, 5.0, None)}
    )
    assert costs.cost_usd("foo", 1_000_000, 0) == 1.0
    assert costs.cost_usd("foo-bar", 1_000_000, 0) == 5.0


def test_longest_prefix_wins_regardless_of_dict_order(monkeypatch) -> None:
    # Old implementation: `for prefix in PRICES: if model.startswith(prefix)`
    # returns on the FIRST match in dict iteration (insertion) order. Here
    # "foo" is inserted first and is also a valid (shorter) prefix match for
    # "foo-bar-baz" -- the old code would incorrectly return foo's price.
    # The fix must pick "foo-bar" (the longer, more specific prefix) instead.
    monkeypatch.setattr(
        costs, "PRICES", {"foo": (1.0, 2.0, None), "foo-bar": (9.0, 9.0, None)}
    )
    assert costs.cost_usd("foo-bar-baz", 1_000_000, 0) == 9.0

    # Same two entries, opposite insertion order -- proves this isn't simply
    # "last match wins" either; the longer prefix must win either way.
    monkeypatch.setattr(
        costs, "PRICES", {"foo-bar": (9.0, 9.0, None), "foo": (1.0, 2.0, None)}
    )
    assert costs.cost_usd("foo-bar-baz", 1_000_000, 0) == 9.0


def test_unknown_model_is_unpriced_and_warns_once(monkeypatch, caplog) -> None:
    monkeypatch.setattr(costs, "_warned_unknown_models", set())
    model = "totally-unknown-model-xyz"

    assert costs.is_priced(model) is False

    with caplog.at_level(logging.WARNING, logger="app.costs"):
        assert costs.cost_usd(model, 1_000, 1_000) == 0.0
        assert costs.cost_usd(model, 1_000, 1_000) == 0.0  # second call: no repeat warning

    warnings = [r for r in caplog.records if model in r.getMessage()]
    assert len(warnings) == 1


def test_free_prefix_model_is_explicitly_free_not_unknown(monkeypatch) -> None:
    monkeypatch.setattr(costs, "FREE_MODEL_PREFIXES", {"local/"})
    model = "local/llama-3-8b"

    # Explicitly free: is_priced() is True (we KNOW its price is $0), unlike
    # an unrecognized model where is_priced() is False.
    assert costs.is_priced(model) is True
    assert costs.cost_usd(model, 1_000_000, 1_000_000) == 0.0


def test_default_model_is_now_priced() -> None:
    # Regression guard for the original bug: DEFAULT_MODEL
    # ("openai/gpt-oss-120b") matched neither "claude-sonnet" nor
    # "claude-haiku" and silently priced at $0.
    assert costs.is_priced("openai/gpt-oss-120b") is True
    assert costs.cost_usd("openai/gpt-oss-120b", 1_000_000, 1_000_000) > 0


def test_claude_sonnet_prefix_fallback_still_works() -> None:
    # tests/test_chat.py's model_override test relies on a synthetic
    # "claude-sonnet-test" string pricing non-zero via prefix match.
    assert costs.cost_usd("claude-sonnet-test", 1_000_000, 1_000_000) > 0


def test_cached_input_slot_present_and_optional() -> None:
    # New third tuple slot: cached_input_per_mtok, which may be a real
    # number (when a public rate exists)...
    _in, _out, cached = costs.PRICES["claude-sonnet-4-5"]
    assert cached == 0.30
    # ...or None when no defensible public cached-input price was found --
    # left unpriced rather than guessed.
    _in, _out, cached = costs.PRICES["moonshotai/kimi-k2.6"]
    assert cached is None
    # Either way cost_usd() (which doesn't use the cached slot yet) still
    # works -- adding the slot was a data change, not a signature change.
    assert costs.cost_usd("moonshotai/kimi-k2.6", 1_000_000, 1_000_000) == 0.95 + 4.00


def test_prices_updated_not_stale() -> None:
    updated = date.fromisoformat(costs.PRICES_UPDATED)
    assert date.today() - updated <= timedelta(days=180)
