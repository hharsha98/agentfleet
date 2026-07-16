"""Voice agent (Phase 10 N): a scoped demo of a browser voice call via Vapi.

Vapi bundles mic capture, STT, TTS, and telephony behind one web SDK
(@vapi-ai/web) — the browser talks to Vapi directly once it has a public key
and an assistant config; our backend never touches the audio stream.

GET /config is the only endpoint. It gates entirely on whether
`vapi_public_key` is set: blank -> {"enabled": false} (no live-voice
demo possible, matches "no Vapi key in this environment" reality), set ->
{"enabled": true, "public_key": ..., "assistant": {...}} where `assistant`
is a static, Vapi-shaped "transient assistant" config the frontend passes to
`vapi.start()` verbatim (see Vapi docs: an assistant can be defined inline
per-call instead of pre-created in the Vapi dashboard).

`vapi_api_key` (server-side Vapi management) is deliberately never read or
returned here — this route only ever hands the browser the public key.
"""

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter()

VOICE_SYSTEM_PROMPT = (
    "You are the AgentFleet Voice assistant, a friendly spoken-word guide to "
    "the AgentFleet platform — a multi-agent orchestration system with a "
    "roster of specialized agents (research, documents, SQL analytics, "
    "competitor monitoring, meeting notes, and more), scheduled runs, and "
    "cost-metered usage. Keep answers short and conversational since this is "
    "a live voice call, not a chat window."
)


def _assistant_config() -> dict:
    return {
        "name": "AgentFleet Voice",
        "firstMessage": "Hi, I'm the AgentFleet voice assistant. What would you like to know?",
        "model": {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "messages": [{"role": "system", "content": VOICE_SYSTEM_PROMPT}],
        },
        "voice": {"provider": "vapi", "voiceId": "Elliot"},
    }


@router.get("/config")
async def get_voice_config() -> dict:
    settings = get_settings()
    if not settings.vapi_public_key:
        return {"enabled": False}
    return {
        "enabled": True,
        "public_key": settings.vapi_public_key,
        "assistant": _assistant_config(),
    }
