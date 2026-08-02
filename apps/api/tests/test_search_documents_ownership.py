"""Regression tests for the cross-tenant RAG leak: app.tools.search_documents
built its query with NO ownership filter, so any agent's search_documents
call could retrieve any user's uploaded document chunks (routes/documents.py,
routes/agents.py, routes/workflows.py, and routes/runs.py all apply
app.ownership.visibility_clause; only the RAG tool path skipped it).

Embeddings are faked (app.services.ingest.embed_texts monkeypatched to
return a fixed 384-dim vector for every input) so this suite never loads the
real ~130MB fastembed model — same reasoning as conftest.py's
EMBEDDINGS_PREWARM=0 guard. Every seeded chunk gets the SAME fake embedding,
so cosine_distance ties at 0 for every visible row and result order doesn't
matter to these assertions; only *membership* (which chunks come back at
all) is under test.

Rows are built directly via the ORM (Document/Chunk), same pattern as
tests/test_run_tasks.py's User creation — no need to exercise the real
ingest_document()/chunking pipeline for an ownership-filter test.
"""

import uuid

from app.db import SessionLocal, engine
from app.models import Chunk, Document, EMBEDDING_DIM, User
from app.tools import run_tool

_FAKE_VECTOR = [0.1] * EMBEDDING_DIM


def _fake_embed_texts(texts: list[str]) -> list[list[float]]:
    return [_FAKE_VECTOR for _ in texts]


async def _make_user(email: str) -> uuid.UUID:
    async with SessionLocal() as session:
        user = User(email=email)
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


async def _make_document_with_chunk(
    *, filename: str, text: str, user_id: uuid.UUID | None
) -> uuid.UUID:
    async with SessionLocal() as session:
        document = Document(filename=filename, user_id=user_id)
        session.add(document)
        await session.flush()
        session.add(
            Chunk(document_id=document.id, ordinal=0, text=text, embedding=_FAKE_VECTOR)
        )
        await session.commit()
        return document.id


async def _cleanup(*, user_ids: list[uuid.UUID], document_ids: list[uuid.UUID]) -> None:
    async with SessionLocal() as session:
        for document_id in document_ids:
            document = await session.get(Document, document_id)
            if document:
                await session.delete(document)  # cascades to its Chunk rows
        for user_id in user_ids:
            user = await session.get(User, user_id)
            if user:
                await session.delete(user)
        await session.commit()
    await engine.dispose()


async def test_search_documents_never_leaks_across_tenants(monkeypatch) -> None:
    monkeypatch.setattr("app.services.ingest.embed_texts", _fake_embed_texts)

    user_a_id = await _make_user("tenant-a@agentfleet.test")
    user_b_id = await _make_user("tenant-b@agentfleet.test")
    doc_ids: list[uuid.UUID] = []
    try:
        doc_ids.append(
            await _make_document_with_chunk(
                filename="a.txt",
                text="ALPHA_SECRET_MARKER belongs to tenant A only",
                user_id=user_a_id,
            )
        )
        doc_ids.append(
            await _make_document_with_chunk(
                filename="b.txt",
                text="BRAVO_SECRET_MARKER belongs to tenant B only",
                user_id=user_b_id,
            )
        )

        # User A's search must see their own chunk and NEVER user B's.
        result_a = await run_tool(
            "search_documents", {"query": "secret", "max_results": 10}, user_id=user_a_id
        )
        assert "ALPHA_SECRET_MARKER" in result_a
        assert "BRAVO_SECRET_MARKER" not in result_a, (
            "cross-tenant leak: user A's search_documents call returned "
            "user B's private document chunk"
        )

        # Symmetric check: user B must never see user A's chunk either.
        result_b = await run_tool(
            "search_documents", {"query": "secret", "max_results": 10}, user_id=user_b_id
        )
        assert "BRAVO_SECRET_MARKER" in result_b
        assert "ALPHA_SECRET_MARKER" not in result_b
    finally:
        await _cleanup(user_ids=[user_a_id, user_b_id], document_ids=doc_ids)


async def test_null_owned_document_is_visible_to_both_tenants(monkeypatch) -> None:
    monkeypatch.setattr("app.services.ingest.embed_texts", _fake_embed_texts)

    user_a_id = await _make_user("tenant-a-null@agentfleet.test")
    user_b_id = await _make_user("tenant-b-null@agentfleet.test")
    doc_ids: list[uuid.UUID] = []
    try:
        doc_ids.append(
            await _make_document_with_chunk(
                filename="legacy.txt",
                text="LEGACY_NULL_MARKER has no owner",
                user_id=None,
            )
        )

        result_a = await run_tool(
            "search_documents", {"query": "legacy", "max_results": 10}, user_id=user_a_id
        )
        result_b = await run_tool(
            "search_documents", {"query": "legacy", "max_results": 10}, user_id=user_b_id
        )
        assert "LEGACY_NULL_MARKER" in result_a
        assert "LEGACY_NULL_MARKER" in result_b
    finally:
        await _cleanup(user_ids=[user_a_id, user_b_id], document_ids=doc_ids)


async def test_no_caller_identity_sees_only_null_owned_documents(monkeypatch) -> None:
    """Decision for user_id=None (no caller identity — e.g. a scheduled run,
    a webhook-triggered run, or the public API-key invoke path used by
    mcp/server.py, none of which have a logged-in user attached to their
    conversation): resolve to "legacy/unowned documents only" rather than
    "nothing at all". This keeps those existing anonymous/system paths able
    to use search_documents against unowned documents, while a user's
    private uploads are NEVER visible without that user's own identity —
    see app/tools.py::search_documents and app/ownership.py for the
    single-definition ownership predicate this relies on.
    """
    monkeypatch.setattr("app.services.ingest.embed_texts", _fake_embed_texts)

    user_a_id = await _make_user("tenant-a-anon@agentfleet.test")
    doc_ids: list[uuid.UUID] = []
    try:
        doc_ids.append(
            await _make_document_with_chunk(
                filename="a.txt",
                text="ALPHA_ANON_MARKER belongs to tenant A only",
                user_id=user_a_id,
            )
        )
        doc_ids.append(
            await _make_document_with_chunk(
                filename="legacy.txt",
                text="LEGACY_ANON_MARKER has no owner",
                user_id=None,
            )
        )

        result_anon = await run_tool(
            "search_documents", {"query": "marker", "max_results": 10}, user_id=None
        )
        assert "LEGACY_ANON_MARKER" in result_anon
        assert "ALPHA_ANON_MARKER" not in result_anon, (
            "an anonymous/system caller (no user_id) must never see a "
            "specific user's private documents"
        )
    finally:
        await _cleanup(user_ids=[user_a_id], document_ids=doc_ids)


async def test_run_tool_user_id_defaults_to_none_and_stays_optional() -> None:
    """Existing callers (and the other 5 tools) that never pass user_id must
    keep working unchanged — run_tool's new parameter is optional."""
    result = await run_tool("search_documents", {"query": "anything"})
    assert isinstance(result, str)
