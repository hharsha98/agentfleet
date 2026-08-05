"""Regression gate: run every agent's eval suite and fail CI on a low score.

Usage: uv run python -m scripts.run_evals

Iterates every agent that has at least one eval case, runs it through
app.services.evals.run_eval, and prints a score table.

Exit codes (CI depends on this contract — see .github/workflows/evals.yml,
which runs this both offline against scripts/stub_llm.py and live against
the real free-tier provider):

  0 — every agent met EVAL_THRESHOLD (env, float 0-1, default 1.0 — all
      cases must pass).
  1 — a REAL eval regression: the provider answered, but at least one
      agent scored below EVAL_THRESHOLD.
  2 — the provider was UNAVAILABLE (unreachable, timed out, or rejected
      auth/rate-limited/5xx'd) before a single case could be scored. This
      is deliberately never conflated with 1: a dead free-tier endpoint
      and a genuinely broken agent used to print the identical "FAILED"
      output and exit 1, which made a flaky provider indistinguishable
      from a real regression in CI. A preflight probe (one minimal
      completion through app.providers.get_llm_client(), see _preflight
      below) now runs before the suite specifically to catch this case
      early and report it honestly.

EVAL_RETRIES (env, int, default 0) controls how many extra attempts the
preflight probe gets on a TRANSIENT failure (connection error, timeout,
429, 5xx) before giving up and returning exit 2. Default 0 keeps a local/
offline run fast — there is nothing transient about a stub server that
isn't running. The live CI gate (evals-live) sets this to 2, since the
real free-tier provider genuinely does have occasional transient blips.
Retries are scoped to the preflight probe only: a real eval case's score
is never retried into a different answer — that would let a flaky "pass"
mask a genuine regression, exactly the failure mode this whole change
exists to prevent.
"""

import asyncio
import os
import sys

import openai
from sqlalchemy import distinct, select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Agent, EvalCase
from app.providers import get_llm_client
from app.services.evals import run_eval

# openai.APIStatusError subclasses (AuthenticationError=401,
# PermissionDeniedError=403, RateLimitError=429, InternalServerError=500)
# all carry a concrete `status_code`; this set names the ones worth a retry.
# 401/403 are deliberately excluded from retries below (see _is_transient) —
# bad/missing credentials do not fix themselves between attempts.
_TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}

# Codes that mean "the provider itself is the problem", not "this specific
# request was malformed" (400/404/409/422 stay OUT of this set on purpose —
# those point at a bug in the probe request itself, not provider health,
# and should surface as a loud crash rather than a misleading exit 2).
_UNAVAILABLE_STATUS_CODES = {401, 403, 429} | set(range(500, 600))


def _classify_provider_error(exc: Exception) -> str | None:
    """Return a short, safe-to-print diagnostic if `exc` means the provider
    is unavailable (exit-2 territory), or None if it means something else
    entirely — a bug in this script's own probe request, which should
    propagate and crash loudly rather than be mistaken for exit 2.
    """
    if isinstance(exc, openai.APIStatusError):
        if exc.status_code in _UNAVAILABLE_STATUS_CODES:
            return f"HTTP {exc.status_code} ({type(exc).__name__})"
        return None
    if isinstance(exc, openai.APIConnectionError):
        # Covers openai.APITimeoutError too (it subclasses APIConnectionError).
        return type(exc).__name__
    return None


def _is_transient(exc: Exception) -> bool:
    """Worth a retry: a transport hiccup, a rate limit, or a 5xx. NEVER an
    auth/permission failure (401/403) — those will not change on the next
    attempt, so retrying just burns the retry budget for no benefit."""
    if isinstance(exc, openai.APIConnectionError):
        return True
    if isinstance(exc, openai.APIStatusError):
        return exc.status_code in _TRANSIENT_STATUS_CODES
    return False


async def _preflight(retries: int) -> str | None:
    """One minimal completion through the configured provider before the
    suite runs. Returns None if the provider answered at all (any content,
    even a bad one — the suite itself is what judges quality), or a
    diagnostic string if it never did. The diagnostic names the base_url
    being probed but NEVER the API key — see app.providers.get_llm_client
    for where that key comes from; it is never touched here.
    """
    settings = get_settings()
    client = get_llm_client()
    attempt = 0
    while True:
        try:
            await client.chat.completions.create(
                model=settings.default_model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            )
            return None
        except Exception as exc:
            diagnostic = _classify_provider_error(exc)
            if diagnostic is None:
                raise  # not a provider-availability shape — a real bug, let it crash loudly
            if attempt < retries and _is_transient(exc):
                attempt += 1
                continue
            return f"{diagnostic} from {settings.free_llm_base_url}"


async def main() -> int:
    threshold = float(os.environ.get("EVAL_THRESHOLD", "1.0"))
    retries = int(os.environ.get("EVAL_RETRIES", "0"))

    diagnostic = await _preflight(retries)
    if diagnostic is not None:
        print(f"Provider unavailable — {diagnostic}", file=sys.stderr)
        print(
            "Cannot distinguish a real eval regression from a dead provider — "
            "skipping the suite rather than reporting a false FAILED.",
            file=sys.stderr,
        )
        return 2

    async with SessionLocal() as session:
        agent_ids = (
            (await session.execute(select(distinct(EvalCase.agent_id)))).scalars().all()
        )
        if not agent_ids:
            print("No agents have eval cases — nothing to run.")
            return 0

        rows: list[tuple[str, int, int]] = []
        failed = False
        for agent_id in agent_ids:
            agent = await session.get(Agent, agent_id)
            if agent is None:
                continue
            run = await run_eval(session, agent_id)
            rows.append((agent.slug, run.passed, run.total))
            rate = (run.passed / run.total) if run.total else 1.0
            if rate < threshold:
                failed = True

    header = f"{'agent':<24} {'passed/total':<14} {'rate':<8}"
    print(header)
    print("-" * len(header))
    for slug, passed, total in rows:
        rate = (passed / total) if total else 1.0
        print(f"{slug:<24} {f'{passed}/{total}':<14} {rate:.0%}")

    if failed:
        print(f"\nFAILED — one or more agents scored below threshold ({threshold:.0%}).")
        return 1
    print(f"\nOK — all agents met threshold ({threshold:.0%}).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
