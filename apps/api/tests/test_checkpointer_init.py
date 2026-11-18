"""The first-chat deadlock (see services/checkpointer.py's module docstring).

On a fresh database, AsyncPostgresSaver.setup() runs CREATE INDEX
CONCURRENTLY, which waits for every transaction already open. It used to
run lazily inside the first chat request while that request held a
transaction open, so the first chats on a new deploy hung with an empty
reply. These tests pin the three properties of the fix:

  * setup can never hang a caller forever (timeout -> MemorySaver);
  * a caller that gives up (visitor closes the tab) can't abort setup for
    everyone else (shared task awaited through asyncio.shield);
  * the chat route no longer holds a transaction open while it streams.
"""

import asyncio
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from langgraph.checkpoint.memory import MemorySaver
from sqlalchemy import select, text

from app.db import SessionLocal, engine
from app.main import app
from app.models import Agent
from app.services import checkpointer


@pytest.fixture(autouse=True)
async def _fresh_checkpointer():
    await checkpointer.close_checkpointer()
    yield
    await checkpointer.close_checkpointer()


def _settings():
    return checkpointer.get_settings()


async def test_memory_mode_returns_memory_saver(monkeypatch):
    monkeypatch.setattr(_settings(), "checkpointer", "memory")
    assert isinstance(await checkpointer.get_checkpointer(), MemorySaver)


async def test_setup_that_never_finishes_falls_back_instead_of_hanging(monkeypatch):
    monkeypatch.setattr(_settings(), "checkpointer", "postgres")
    monkeypatch.setattr(_settings(), "checkpointer_setup_timeout_seconds", 0.2)

    async def never_finishes(_settings):
        await asyncio.Event().wait()

    monkeypatch.setattr(checkpointer, "_open_postgres_saver", never_finishes)
    saver = await asyncio.wait_for(checkpointer.get_checkpointer(), timeout=5)
    assert isinstance(saver, MemorySaver)


async def test_a_cancelled_caller_does_not_abort_setup_for_everyone(monkeypatch):
    monkeypatch.setattr(_settings(), "checkpointer", "postgres")
    monkeypatch.setattr(_settings(), "checkpointer_setup_timeout_seconds", 5)
    release = asyncio.Event()
    sentinel = object()
    calls = 0

    async def slow_open(_settings):
        nonlocal calls
        calls += 1
        await release.wait()
        return sentinel, None

    monkeypatch.setattr(checkpointer, "_open_postgres_saver", slow_open)

    first = asyncio.create_task(checkpointer.get_checkpointer())
    await asyncio.sleep(0.05)
    first.cancel()  # the first visitor closes the tab mid-setup
    with pytest.raises(asyncio.CancelledError):
        await first

    release.set()
    saver = await asyncio.wait_for(checkpointer.get_checkpointer(), timeout=5)
    assert saver is sentinel  # the same setup finished, it was not aborted
    assert calls == 1  # ...and it was not restarted from scratch


async def test_real_setup_beside_an_open_transaction_returns_promptly(monkeypatch):
    """Integration: a brand-new schema (so setup really runs CREATE INDEX
    CONCURRENTLY) while another connection sits idle in a transaction, the
    exact state that used to hang. Whether Postgres makes the index build
    wait or not, get_checkpointer() must come back within its time limit."""
    schema = f"ckpt_{uuid.uuid4().hex[:10]}"
    monkeypatch.setattr(_settings(), "checkpointer", "postgres")
    monkeypatch.setattr(_settings(), "database_schema", schema)
    monkeypatch.setattr(_settings(), "checkpointer_setup_timeout_seconds", 2.0)

    await engine.dispose()
    async with engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        async with SessionLocal() as blocker:
            # Same shape as the old chat request: a read, then left idle.
            await blocker.execute(select(Agent).limit(1))
            saver = await asyncio.wait_for(checkpointer.get_checkpointer(), timeout=15)
            assert saver is not None
    finally:
        await checkpointer.close_checkpointer()
        async with engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()


async def test_chat_route_releases_its_transaction_before_streaming(monkeypatch):
    """While the reply streams, the request must not be holding a
    connection idle-in-transaction (it pinned 1 of the pool's 5 per chat)."""
    from app.routes import chat as chat_routes

    seen: dict = {}

    async def fake_runner(conversation_id, content):
        async with engine.connect() as probe:
            rows = await probe.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() AND state = 'idle in transaction' "
                    "AND pid <> pg_backend_pid()"
                )
            )
            seen["idle_in_tx"] = rows.scalar_one()
        yield 'data: {"type": "done", "usage": {}}\n\n'

    monkeypatch.setattr(chat_routes, "stream_chat_graph", fake_runner)
    monkeypatch.setattr(chat_routes, "stream_chat", fake_runner)
    monkeypatch.setattr(chat_routes, "stream_chat_pydantic", fake_runner)

    await engine.dispose()
    async with SessionLocal() as session:
        agent_id = (
            await session.execute(select(Agent.id).where(Agent.slug == "creative-writer"))
        ).scalar_one()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/api/v1/conversations", json={"agent_id": str(agent_id)})
        assert created.status_code == 201, created.text
        conv_id = created.json()["id"]
        reply = await client.post(
            f"/api/v1/conversations/{conv_id}/messages", json={"content": "hi"}
        )
        assert reply.status_code == 200
        assert '"done"' in reply.text

    assert seen["idle_in_tx"] == 0
    await engine.dispose()
