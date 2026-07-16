"""Tests for Phase 12 B: Bearer HS256 JWT auth (app/auth.py) and resource
ownership/visibility (app/ownership.py).

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_webhooks.py / test_playground.py (see those files' docstrings for why
— asyncpg connections are bound to the event loop that created them).

Most of this suite talks to the API with an EXPLICIT token (via
tests.conftest.RawAsyncClient, the real unpatched httpx.AsyncClient) rather
than the session-wide auto-injected default client, precisely because these
tests are about auth itself: missing headers, bad signatures, expired
tokens, forged algorithms, and per-user ownership all require control over
exactly which (if any) token is sent.
"""

import uuid
from datetime import timedelta

import jwt
from httpx import ASGITransport
from sqlalchemy import select

from app.db import SessionLocal, engine
from app.main import app
from app.models import Agent, Conversation, Message, Run, User, Webhook
from scripts.seed_agents import main as seed_builtin_agents
from tests.conftest import RawAsyncClient, mint_token


def _client(token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return RawAsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers)


# --- missing / invalid token -------------------------------------------------


async def test_no_auth_header_rejected_on_representative_endpoints() -> None:
    """3 representative endpoints: a list, a create, and a by-id GET — all
    401 with no Authorization header at all."""
    await engine.dispose()

    async with _client() as client:
        list_res = await client.get("/api/v1/agents")
        assert list_res.status_code == 401
        assert list_res.headers.get("www-authenticate") == "Bearer"

        create_res = await client.post(
            "/api/v1/agents",
            json={"slug": "no-auth-should-fail", "name": "x", "system_prompt": "x"},
        )
        assert create_res.status_code == 401

        by_id_res = await client.get(f"/api/v1/runs/{uuid.uuid4()}")
        assert by_id_res.status_code == 401


async def test_bad_signature_rejected() -> None:
    await engine.dispose()
    bad_token = mint_token(secret="a-completely-different-secret-value")
    async with _client(bad_token) as client:
        res = await client.get("/api/v1/agents")
        assert res.status_code == 401


async def test_expired_token_rejected() -> None:
    await engine.dispose()
    expired_token = mint_token(exp_delta=timedelta(seconds=-10))
    async with _client(expired_token) as client:
        res = await client.get("/api/v1/agents")
        assert res.status_code == 401


async def test_alg_none_forged_token_rejected() -> None:
    """A token whose header claims alg=none (no signature at all) must be
    rejected — decode_token restricts algorithms=["HS256"] explicitly."""
    await engine.dispose()
    forged = jwt.encode(
        {"sub": "attacker@evil.test", "email": "attacker@evil.test", "iat": 0, "exp": 9999999999},
        key="",
        algorithm="none",
    )
    async with _client(forged) as client:
        res = await client.get("/api/v1/agents")
        assert res.status_code == 401


# --- valid token: create-on-first-call, reused on second ---------------------


async def test_valid_token_creates_user_once_and_reuses_it() -> None:
    await engine.dispose()
    email = f"fresh-{uuid.uuid4().hex[:12]}@agentfleet.test"
    token = mint_token(email=email)

    try:
        async with _client(token) as client:
            first_res = await client.get("/api/v1/agents")
            assert first_res.status_code == 200

            async with SessionLocal() as session:
                rows = (
                    (await session.execute(select(User).where(User.email == email)))
                    .scalars()
                    .all()
                )
                assert len(rows) == 1
                assert rows[0].email == email

            second_res = await client.get("/api/v1/agents")
            assert second_res.status_code == 200

            async with SessionLocal() as session:
                rows = (
                    (await session.execute(select(User).where(User.email == email)))
                    .scalars()
                    .all()
                )
                assert len(rows) == 1  # no duplicate row created on 2nd call
    finally:
        async with SessionLocal() as session:
            row = (
                await session.execute(select(User).where(User.email == email))
            ).scalar_one_or_none()
            if row:
                await session.delete(row)
            await session.commit()
        await engine.dispose()


# --- ownership / visibility ---------------------------------------------------


async def test_agent_ownership_visibility_and_builtin_protection() -> None:
    """User A creates an agent -> user B's list doesn't include it, and B
    can't mutate it (404, existence not leaked). Builtin agents are visible
    to both but never mutable via the API (403), even for an authenticated
    caller.

    NOTE: this API has no standalone `GET /agents/{id}` endpoint (only
    list, PATCH, DELETE, publish, and /versions sub-resources) — the "GET
    by id -> 404 for B" case from the spec is exercised here via
    `GET /agents/{id}/versions`, which applies the identical visibility
    check, plus PATCH/DELETE by B -> 404 directly.
    """
    await engine.dispose()
    await seed_builtin_agents()
    await engine.dispose()

    email_a = f"owner-a-{uuid.uuid4().hex[:8]}@agentfleet.test"
    email_b = f"owner-b-{uuid.uuid4().hex[:8]}@agentfleet.test"
    token_a = mint_token(email=email_a)
    token_b = mint_token(email=email_b)

    created_agent_id: str | None = None
    try:
        async with _client(token_a) as client_a, _client(token_b) as client_b:
            create_res = await client_a.post(
                "/api/v1/agents",
                json={
                    "slug": f"owned-by-a-{uuid.uuid4().hex[:8]}",
                    "name": "Owned by A",
                    "system_prompt": "You are A's private agent.",
                },
            )
            assert create_res.status_code == 201, create_res.text
            agent = create_res.json()
            created_agent_id = agent["id"]

            # --- B's list does not include A's private agent ---
            list_b_res = await client_b.get("/api/v1/agents", params={"limit": 200})
            assert list_b_res.status_code == 200
            assert all(a["id"] != created_agent_id for a in list_b_res.json())

            # --- A's list DOES include it ---
            list_a_res = await client_a.get("/api/v1/agents", params={"limit": 200})
            assert any(a["id"] == created_agent_id for a in list_a_res.json())

            # --- "GET by id" surrogate (/versions) -> 404 for B ---
            versions_b_res = await client_b.get(f"/api/v1/agents/{created_agent_id}/versions")
            assert versions_b_res.status_code == 404

            # --- versions readable for A (owner) ---
            versions_a_res = await client_a.get(f"/api/v1/agents/{created_agent_id}/versions")
            assert versions_a_res.status_code == 200

            # --- PATCH by B -> 404 (not 403 — existence not leaked) ---
            patch_b_res = await client_b.patch(
                f"/api/v1/agents/{created_agent_id}", json={"name": "hijacked"}
            )
            assert patch_b_res.status_code == 404

            # --- DELETE by B -> 404 ---
            delete_b_res = await client_b.delete(f"/api/v1/agents/{created_agent_id}")
            assert delete_b_res.status_code == 404

            # --- builtin agent: visible to both A and B ---
            builtin_a_res = await client_a.get("/api/v1/agents", params={"limit": 200})
            builtin = next(a for a in builtin_a_res.json() if a["is_builtin"])
            builtin_b_res = await client_b.get("/api/v1/agents", params={"limit": 200})
            assert any(a["id"] == builtin["id"] for a in builtin_b_res.json())

            # --- DELETE builtin -> 403, even for an authenticated caller ---
            delete_builtin_res = await client_a.delete(f"/api/v1/agents/{builtin['id']}")
            assert delete_builtin_res.status_code == 403

            # --- PATCH builtin -> 403 too ---
            patch_builtin_res = await client_a.patch(
                f"/api/v1/agents/{builtin['id']}", json={"name": "hijacked builtin"}
            )
            assert patch_builtin_res.status_code == 403

            # --- DELETE by the actual owner (A) -> ok ---
            delete_a_res = await client_a.delete(f"/api/v1/agents/{created_agent_id}")
            assert delete_a_res.status_code == 200
            created_agent_id = None
    finally:
        if created_agent_id:
            async with SessionLocal() as session:
                row = await session.get(Agent, uuid.UUID(created_agent_id))
                if row:
                    await session.delete(row)
                await session.commit()
        async with SessionLocal() as session:
            for email in (email_a, email_b):
                row = (
                    await session.execute(select(User).where(User.email == email))
                ).scalar_one_or_none()
                if row:
                    await session.delete(row)
            await session.commit()
        await engine.dispose()


# --- Conversation -> Message cascade fix --------------------------------------


async def test_conversation_delete_cascades_to_messages_no_not_null_violation() -> None:
    """Regression test for the known cascade bug (docs/PRODUCTION_PLAN.md):
    before the Conversation.messages relationship had
    cascade="all, delete-orphan" + passive_deletes=True, an ORM
    `session.delete(conversation)` tried to NULL out messages.conversation_id
    (NOT NULL) instead of using the DB's ON DELETE CASCADE, and raised an
    IntegrityError. This must now succeed cleanly and leave no orphaned
    messages."""
    await engine.dispose()

    async with SessionLocal() as session:
        agent = (await session.execute(select(Agent).limit(1))).scalar_one_or_none()
        if agent is None:
            await seed_builtin_agents()
            agent = (await session.execute(select(Agent).limit(1))).scalar_one()

        conversation = Conversation(agent_id=agent.id)
        session.add(conversation)
        await session.flush()
        conversation_id = conversation.id
        session.add_all(
            [
                Message(conversation_id=conversation_id, role="user", content="hi"),
                Message(conversation_id=conversation_id, role="assistant", content="hello"),
            ]
        )
        await session.commit()

        conversation = await session.get(Conversation, conversation_id)
        await session.delete(conversation)
        await session.commit()  # must NOT raise IntegrityError

        remaining = (
            (
                await session.execute(
                    select(Message).where(Message.conversation_id == conversation_id)
                )
            )
            .scalars()
            .all()
        )
        assert remaining == []

    await engine.dispose()


# --- public surfaces stay unauthenticated -------------------------------------


async def test_health_and_webhook_trigger_work_without_jwt() -> None:
    """/health and /api/v1/hooks/{id} (which has its own bearer-secret auth,
    unrelated to JWT) must both work with NO Authorization JWT header."""
    await engine.dispose()

    created_webhook_id: str | None = None
    try:
        async with _client() as anon_client:
            health_res = await anon_client.get("/health")
            assert health_res.status_code == 200
            assert health_res.json()["status"] == "ok"

        # Seed a webhook using an authenticated call (webhook management IS
        # gated behind JWT auth — only the /hooks/{id} trigger path isn't).
        token = mint_token()
        async with _client(token) as auth_client:
            create_res = await auth_client.post(
                "/api/v1/webhooks",
                json={"name": "auth-test-hook", "goal_template": "Handle: {payload}"},
            )
            assert create_res.status_code == 201, create_res.text
            webhook = create_res.json()
            created_webhook_id = webhook["id"]
            full_secret = webhook["secret"]

        # Trigger with NO JWT — only the webhook's own bearer secret.
        async with _client() as anon_client:
            trigger_res = await anon_client.post(
                f"/api/v1/hooks/{webhook['id']}",
                content=b'{"x":1}',
                headers={"Authorization": f"Bearer {full_secret}"},
            )
            assert trigger_res.status_code == 200, trigger_res.text
    finally:
        if created_webhook_id:
            async with SessionLocal() as session:
                webhook_row = await session.get(Webhook, uuid.UUID(created_webhook_id))
                if webhook_row:
                    runs = (
                        (await session.execute(select(Run).where(Run.goal == 'Handle: {"x":1}')))
                        .scalars()
                        .all()
                    )
                    for r in runs:
                        await session.delete(r)
                    await session.delete(webhook_row)
                await session.commit()
        await engine.dispose()
