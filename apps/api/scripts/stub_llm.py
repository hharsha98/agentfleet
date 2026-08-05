"""A tiny OpenAI-compatible stub for `POST /v1/chat/completions`.

Built once, used twice (Half B of the Wave 1 roadmap):

1. The `evals-offline` CI gate points `app.providers.get_llm_client()` at
   this instead of the real free-tier provider, so the eval suite (and its
   `run_evals.py` gate) is hermetic — no API key, no internet, no flake from
   a rate-limited free tier. Every PR, including forks, can run it.
2. Wave 3 mounts a different `STUB_LLM_FIXTURES` file and runs this same
   server inside a kind cluster for the k8s smoke tests, so the deployment
   manifests get exercised against a provider that never costs money or
   goes down.

Because of (2) this is written as a real small deployable service — a
FastAPI `app`, a `/health` endpoint for a readiness probe, config entirely
via env — not as an in-process pytest fixture. `tests/test_stub_llm.py`
drives it with FastAPI's TestClient (no process, no socket) for exactly
that reason: the same `app` object is both test-driven and, via uvicorn,
actually deployable.

Run it:
    uv run python -m scripts.stub_llm          # reads STUB_LLM_PORT (default 8099)
    uv run uvicorn scripts.stub_llm:app --port 8099

The default port is 8099 rather than the more obvious 8081 because
`docker/compose.yaml` already publishes searxng on 8081 — a developer with
the normal dev stack up would otherwise get a confusing bind failure the
first time they ran this locally. CI has no searxng, so any free port would
work there; the default is chosen for the case that actually breaks.

Determinism is the whole point of a hermetic gate: given the same request
body, this always returns the same response. There is no randomness or
wall-clock dependence anywhere in the response payload (see `_RESPONSE_ID`
/ `_CREATED` below) — a flaky offline gate would be worse than no gate.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)

app = FastAPI(title="AgentFleet stub LLM", version="0.1.0")

# Fixed, not wall-clock: real `created` timestamps would make two identical
# requests produce byte-different responses, which is the one thing this
# server exists to avoid. The literal value carries no meaning beyond "a
# plausible-looking unix timestamp"; nothing downstream parses it as real.
_CREATED = 1_700_000_000

_DEFAULT_FIXTURES_PATH = Path(__file__).parent / "fixtures" / "llm_fixtures.json"


def _fixtures_path() -> Path:
    # Read at call time, not import time, so tests can point STUB_LLM_FIXTURES
    # at a fixture of their own before constructing the app's fixtures — and
    # so Wave 3 can bind-mount a different file into the container without a
    # code change, per the module docstring.
    override = os.environ.get("STUB_LLM_FIXTURES")
    return Path(override) if override else _DEFAULT_FIXTURES_PATH


def load_fixtures(path: Path | None = None) -> dict[str, Any]:
    """Load and lightly validate the fixtures file. Raises on anything
    malformed — this is a server, and a broken fixtures file should fail
    loudly at startup (or at first request in tests), not silently fall
    back to something surprising mid-CI-run.
    """
    p = path or _fixtures_path()
    try:
        raw = p.read_text()
    except OSError as exc:
        raise RuntimeError(f"stub_llm: cannot read fixtures file {p}: {exc}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"stub_llm: fixtures file {p} is not valid JSON: {exc}") from exc

    if not isinstance(data, dict) or "default" not in data:
        raise RuntimeError(f"stub_llm: fixtures file {p} must be an object with a 'default' key")
    if not isinstance(data["default"], str):
        raise RuntimeError(f"stub_llm: fixtures file {p} 'default' must be a string")
    rules = data.get("rules", [])
    if not isinstance(rules, list):
        raise RuntimeError(f"stub_llm: fixtures file {p} 'rules' must be a list")
    for rule in rules:
        if not isinstance(rule, dict) or "match" not in rule or "reply" not in rule:
            raise RuntimeError(
                f"stub_llm: fixtures file {p} has a rule missing 'match' or 'reply': {rule!r}"
            )
    return data


# Loaded once at import time (server startup) — every request reloading the
# file from disk would defeat the point of a fast, hermetic gate, and the
# fixtures are meant to be static per-process (Wave 3 changes them by
# mounting a different file and restarting the container, not by hot-reload).
_FIXTURES = load_fixtures()


def select_reply(fixtures: dict[str, Any], last_user_message: str) -> str:
    """First rule whose `match` substrings ALL appear (case-insensitive) in
    `last_user_message` wins; otherwise the fixtures' `default` reply.

    Rules are checked in file order, so put more specific rules before
    broader ones if a request could ever satisfy both — this repo's own
    fixtures file avoids that ambiguity outright by giving every case a
    distinctive, non-overlapping match phrase (see its module comment).
    """
    haystack = last_user_message.lower()
    for rule in fixtures.get("rules", []):
        match_strings: list[str] = rule.get("match") or []
        if match_strings and all(s.lower() in haystack for s in match_strings):
            return rule["reply"]
    return fixtures["default"]


def _last_user_message(messages: list[dict[str, Any]]) -> str:
    """The text of the most recent `role: user` message. Tool/assistant/system
    turns are skipped — response selection only ever looks at what the user
    most recently asked, matching the fixtures schema's documented contract.

    `content` is usually a plain string on the wire this app sends, but the
    OpenAI content-block list shape is a real possibility for any
    OpenAI-compatible caller, so it's handled the same way
    app/services/chat.py's `_content_text` handles it on the receiving side:
    join any text blocks, drop anything else rather than crash.
    """
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and isinstance(block.get("text"), str)
            ]
            return " ".join(parts)
        return ""
    return ""


def _approx_tokens(text: str) -> int:
    """A plausible, deterministic token count — not a real tokenizer (no
    tokenizer dependency belongs in a stub whose only job is to be fast and
    hermetic). Whitespace-split word count, floored at 1 so an empty string
    still reports a non-zero prompt/completion size the way a real provider
    would (a genuinely empty completion is a provider bug, not a stub
    concern to reproduce).
    """
    return max(1, len(text.split()))


def _usage(prompt_text: str, completion_text: str) -> dict[str, int]:
    prompt_tokens = _approx_tokens(prompt_text)
    completion_tokens = _approx_tokens(completion_text)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }


def _response_id(body: dict[str, Any]) -> str:
    # Deterministic (hash of the request), not random — see module
    # docstring. Collisions across genuinely different requests are
    # harmless: nothing in this app keys off completion IDs.
    digest = hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()
    return f"chatcmpl-stub-{digest[:16]}"


def _sse(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": {"message": "invalid JSON body"}}, status_code=400)

    messages = body.get("messages") or []
    if not isinstance(messages, list):
        return JSONResponse(
            {"error": {"message": "'messages' must be a list"}}, status_code=400
        )

    model = body.get("model") or "stub-model"
    reply_text = select_reply(_FIXTURES, _last_user_message(messages))
    prompt_text = " ".join(str(m.get("content") or "") for m in messages)
    usage = _usage(prompt_text, reply_text)
    response_id = _response_id(body)
    stream = bool(body.get("stream"))

    if not stream:
        return JSONResponse(
            {
                "id": response_id,
                "object": "chat.completion",
                "created": _CREATED,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": reply_text},
                        "finish_reason": "stop",
                        "logprobs": None,
                    }
                ],
                "usage": usage,
            }
        )

    # CRITICAL path (see module docstring): app/services/chat.py always
    # calls with stream=True, and its `openai` SDK client parses this SSE
    # framing into ChatCompletionChunk objects — get the shape wrong here
    # and every eval silently returns empty text instead of failing loudly.
    include_usage = bool((body.get("stream_options") or {}).get("include_usage"))

    def _chunk(delta: dict[str, Any], finish_reason: str | None) -> dict[str, Any]:
        return {
            "id": response_id,
            "object": "chat.completion.chunk",
            "created": _CREATED,
            "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
        }

    async def _stream() -> Any:
        # First chunk carries the role, matching real providers — the SDK
        # doesn't require this, but several OpenAI-compatible providers do
        # it and app/services/chat.py is written to tolerate either order,
        # so exercising the more common shape here is the more useful test.
        yield _sse(_chunk({"role": "assistant", "content": ""}, None))
        if reply_text:
            yield _sse(_chunk({"content": reply_text}, None))
        yield _sse(_chunk({}, "stop"))
        if include_usage:
            # Real providers send a final chunk with an EMPTY choices list
            # and the usage block — app/services/chat.py's
            # `chunk.choices[0].delta if chunk.choices else None` exists
            # specifically to handle this shape without crashing.
            yield _sse(
                {
                    "id": response_id,
                    "object": "chat.completion.chunk",
                    "created": _CREATED,
                    "model": model,
                    "choices": [],
                    "usage": usage,
                }
            )
        yield "data: [DONE]\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    # 8099, not 8081: docker/compose.yaml publishes searxng on 8081. See the
    # module docstring — CI would tolerate either, local dev would not.
    port = int(os.environ.get("STUB_LLM_PORT", "8099"))
    uvicorn.run(app, host="0.0.0.0", port=port)
