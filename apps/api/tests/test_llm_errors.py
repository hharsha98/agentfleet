"""services/llm_errors.py: friendlier provider-error wording that must not
change how mission retries are routed, plus the "no provider configured"
short-circuit and the LangGraph runtime's timeouts."""

import json

import httpx
import openai
import pytest

from app.config import get_settings
from app.db import SessionLocal, engine
from app.models import Agent, Conversation
from app.services import checkpointer
from app.services.llm_errors import NOT_CONFIGURED_MESSAGE, provider_error_message
from app.services.orchestrator import classify_failure

_REQ = httpx.Request("POST", "https://llm.test/v1/chat/completions")


def _status_error(cls, status: int):
    return cls("provider said no", response=httpx.Response(status, request=_REQ), body=None)


EXCEPTIONS = [
    openai.APIConnectionError(request=_REQ),
    openai.APITimeoutError(request=_REQ),
    _status_error(openai.AuthenticationError, 401),
    _status_error(openai.PermissionDeniedError, 403),
    _status_error(openai.NotFoundError, 404),
    _status_error(openai.RateLimitError, 429),
    _status_error(openai.InternalServerError, 500),
    _status_error(openai.BadRequestError, 400),
    RuntimeError("boom"),
]


@pytest.mark.parametrize("exc", EXCEPTIONS, ids=lambda e: type(e).__name__)
def test_friendly_message_keeps_the_retry_classification(exc):
    name = type(exc).__name__
    old = f"The model provider returned an error ({name}). Please try again."
    new = provider_error_message(exc, "acme/model")
    assert new.endswith(f"({name})") or new == old
    assert classify_failure(new) == classify_failure(old)


@pytest.mark.parametrize("exc", EXCEPTIONS, ids=lambda e: type(e).__name__)
def test_friendly_message_never_leaks_provider_text(exc):
    assert "provider said no" not in provider_error_message(exc)


def test_missing_model_names_the_model():
    msg = provider_error_message(_status_error(openai.NotFoundError, 404), "acme/gone")
    assert "acme/gone" in msg and "DEFAULT_MODEL" in msg


def test_unconfigured_provider_stops_missions_immediately():
    assert classify_failure(NOT_CONFIGURED_MESSAGE) == "capability"


async def _conversation_for(slug: str):
    await engine.dispose()
    async with SessionLocal() as session:
        from sqlalchemy import select

        agent = (await session.execute(select(Agent).where(Agent.slug == slug))).scalar_one()
        conversation = Conversation(agent_id=agent.id)
        session.add(conversation)
        await session.commit()
        return conversation.id


async def _frames(gen) -> list[dict]:
    return [json.loads(frame[6:]) async for frame in gen]


async def test_native_runtime_says_plainly_when_no_provider_is_configured(monkeypatch):
    from app.services.chat import stream_chat

    monkeypatch.setattr(get_settings(), "free_llm_base_url", "")
    conv_id = await _conversation_for("creative-writer")
    frames = await _frames(stream_chat(conv_id, "hello"))
    assert frames == [{"type": "error", "message": NOT_CONFIGURED_MESSAGE}]
    await engine.dispose()


async def test_graph_runtime_uses_timeouts_and_friendly_errors(monkeypatch):
    from app.services import graph_runtime

    created: list[dict] = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            created.append(kwargs)

        def bind_tools(self, specs):
            return self

        async def ainvoke(self, messages):
            raise openai.APIConnectionError(request=_REQ)

        async def astream(self, messages):
            raise openai.APIConnectionError(request=_REQ)
            yield  # pragma: no cover — makes this an async generator

    monkeypatch.setattr(graph_runtime, "ChatOpenAI", FakeChatOpenAI)
    monkeypatch.setattr(get_settings(), "checkpointer", "memory")
    await checkpointer.close_checkpointer()

    conv_id = await _conversation_for("creative-writer")
    frames = await _frames(graph_runtime.stream_chat_graph(conv_id, "hello"))
    await checkpointer.close_checkpointer()
    await engine.dispose()

    errors = [f for f in frames if f["type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["message"].startswith("Couldn't reach the AI provider")
    assert errors[0]["message"].endswith("(APIConnectionError)")
    # Both the main model and the salvage model got the app's timeout policy.
    assert len(created) == 2
    for kwargs in created:
        assert isinstance(kwargs["timeout"], httpx.Timeout)
        assert kwargs["timeout"].read == get_settings().llm_read_timeout_seconds
        assert kwargs["max_retries"] == get_settings().llm_max_retries


async def test_graph_runtime_streams_list_shaped_content(monkeypatch):
    """Gateways that stream content as a LIST of blocks used to produce a
    blank reply in the LangGraph runtime (it only kept str content)."""
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, AIMessageChunk
    from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

    from app.services import graph_runtime

    blocks = [{"type": "text", "text": "Hello "}, {"type": "text", "text": "from blocks"}]

    class ListContentModel(BaseChatModel):
        """Streams one chunk whose content is a list of blocks, like the
        gateways behind FREE_LLM_BASE_URL sometimes do."""

        @property
        def _llm_type(self) -> str:
            return "list-content-fake"

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content=blocks))])

        async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
            yield ChatGenerationChunk(message=AIMessageChunk(content=blocks))

    def fake_chat_openai(**kwargs):
        return ListContentModel()

    monkeypatch.setattr(graph_runtime, "ChatOpenAI", fake_chat_openai)
    monkeypatch.setattr(get_settings(), "checkpointer", "memory")
    await checkpointer.close_checkpointer()

    conv_id = await _conversation_for("creative-writer")  # no tools bound
    frames = await _frames(graph_runtime.stream_chat_graph(conv_id, "hello"))
    await checkpointer.close_checkpointer()
    await engine.dispose()

    text = "".join(f["content"] for f in frames if f["type"] == "token")
    assert text == "Hello from blocks"
    assert frames[-1]["type"] == "done"
