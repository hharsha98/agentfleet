"""Per-token pricing.

Lookup order: EXACT match first, then LONGEST-matching prefix. This is not
dict iteration order dependent. A naive `for prefix in PRICES: if
model.startswith(prefix): ...` loop breaks the moment two prefixes share a
stem — e.g. "claude-sonnet" and "claude-sonnet-4-5" are both prefixes of
"claude-sonnet-4-5-20260930", and whichever happened to be inserted first
into the dict would win, regardless of which is the more specific (and
therefore more accurate) price. Longest-prefix-wins fixes that
deterministically, independent of dict insertion order.

Free-proxy models: dev/testing routes every call through a free
OpenAI-compatible proxy (FREE_LLM_BASE_URL, see .env.example) so real spend
against it is genuinely $0. cost_usd() still models the UNDERLYING model's
public list price rather than treating it as free — that's what makes the
USD budget cap (services/budget.py) and the usage dashboard
(routes/usage.py) exercisable instead of permanently stuck at zero. The web
UI labels this "modeled cost (list price)" so it reads as an honest estimate
of what the tokens would cost against a paid provider, not metered real
spend (see apps/web/app/(app)/usage/page.tsx).

FREE_MODEL_PREFIXES (below) is for models that are genuinely,
unconditionally free — e.g. a self-hosted local model with no per-token API
charge at all, priced at exactly $0 ON PURPOSE. That's different from a
model this file simply doesn't recognize yet, which is ALSO $0 but only
because nobody has looked up its price — see is_priced() to tell the two
apart. Nothing currently configured qualifies as genuinely free (per the
paragraph above, even the free-proxy's default model is priced at its
underlying list price), so the set starts empty; the mechanism exists for
the day a local/self-hosted model shows up.

Prices are USD per 1,000,000 tokens: (input, output, cached_input | None).
cached_input is unused today — no caller passes cached-token counts yet,
prompt caching is a later phase — but the slot is reserved now so wiring it
up later is a data change to this dict, not a signature change to
cost_usd().
"""

import logging

logger = logging.getLogger(__name__)

# model (or model prefix) -> (input_per_mtok, output_per_mtok, cached_input_per_mtok | None)
PRICES: dict[str, tuple[float, float, float | None]] = {
    # --- Anthropic — ADR-005's paid demo path; exact literals used by
    # scripts/seed_demo.py's DEMO_MODEL_STRONG / DEMO_MODEL_FAST. ---
    # Source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-08-02).
    "claude-sonnet-4-5": (3.00, 15.00, 0.30),
    # Cache-read multiplier (10% of base input) confirmed in Anthropic's
    # prompt-caching docs: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    "claude-haiku-4-5": (1.00, 5.00, 0.10),
    # Generic family fallback (longest-prefix, not exact) so any other
    # claude-sonnet/claude-haiku variant — a dated snapshot, or a synthetic
    # model_override string like tests/test_chat.py's "claude-sonnet-test"
    # — still prices sensibly instead of falling through to "unpriced".
    # Same rate as the exact -4-5 entries above as of 2026-08-02.
    "claude-sonnet": (3.00, 15.00, 0.30),
    "claude-haiku": (1.00, 5.00, 0.10),
    # --- Default model (config.py Settings.default_model / .env DEFAULT_MODEL) ---
    # Routed through FREE_LLM_BASE_URL in dev, so real spend against THIS
    # deployment is $0 — but priced here at the underlying open-weight
    # model's list price via Groq (the primary host named in ARCHITECTURE.md
    # ADR-005) so the budget cap and dashboard have something real to work
    # with. Source: https://groq.com/pricing (checked 2026-08-02); cached
    # input confirmed there as half the base input rate.
    "openai/gpt-oss-120b": (0.15, 0.75, 0.075),
    # --- Self-heal escalation ladder — .env SELF_HEAL_ESCALATION_MODELS ---
    # Source: https://openrouter.ai/moonshotai/kimi-k2.6 (checked 2026-08-02).
    # No confirmed public cached-input rate for this one — left None rather
    # than guessed.
    "moonshotai/kimi-k2.6": (0.95, 4.00, None),
    # Source: https://deepseek.ai/pricing (checked 2026-08-02).
    "deepseek-ai/deepseek-v4-pro": (0.435, 0.87, 0.003625),
}

# Prefixes that are genuinely, unconditionally free — priced at $0 on
# purpose, not by accident. See module docstring for why this is empty
# today rather than containing the free-proxy's default model.
FREE_MODEL_PREFIXES: set[str] = set()

# Logged once per unknown model, not once per call — an agent stuck calling
# an unpriced model every turn would otherwise flood the log.
_warned_unknown_models: set[str] = set()

# Prices are dated facts, not code — bump this whenever PRICES changes.
# tests/test_costs.py fails once this drifts more than 180 days stale.
PRICES_UPDATED = "2026-08-02"


def _lookup(model: str) -> tuple[float, float, float | None] | None:
    """Exact match first, then the longest matching prefix. None if nothing
    in PRICES matches `model` at all."""
    exact = PRICES.get(model)
    if exact is not None:
        return exact
    best_prefix = ""
    best_price: tuple[float, float, float | None] | None = None
    for prefix, price in PRICES.items():
        if len(prefix) > len(best_prefix) and model.startswith(prefix):
            best_prefix = prefix
            best_price = price
    return best_price


def is_priced(model: str | None) -> bool:
    """True if `model` has a known dollar price OR is explicitly marked
    free via FREE_MODEL_PREFIXES. False means this file has never heard of
    the model — cost_usd() will return $0.00 for it, but that $0.00 means
    "unknown", not "free" (see module docstring)."""
    if not model:
        return False
    if any(model.startswith(prefix) for prefix in FREE_MODEL_PREFIXES):
        return True
    return _lookup(model) is not None


def cost_usd(model: str, tokens_in: int, tokens_out: int) -> float:
    if not model:
        return 0.0
    if any(model.startswith(prefix) for prefix in FREE_MODEL_PREFIXES):
        return 0.0
    price = _lookup(model)
    if price is None:
        if model not in _warned_unknown_models:
            _warned_unknown_models.add(model)
            logger.warning(
                "app.costs: no price entry for model %r — cost_usd() returns "
                "$0.00 for it. Add it to PRICES (with a cited source) or to "
                "FREE_MODEL_PREFIXES if it is genuinely free.",
                model,
            )
        return 0.0
    price_in, price_out, _cached_in = price
    return (tokens_in * price_in + tokens_out * price_out) / 1_000_000
