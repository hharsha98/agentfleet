"""An upload whose embedding step fails (e.g. the ~130MB model could not be
downloaded) answers 503 with a sentence a visitor can act on, instead of a
bare 500 that the page could not even parse."""

from httpx import ASGITransport, AsyncClient

from app.db import engine
from app.main import app
from app.services import ingest


async def test_upload_reports_unavailable_embedding_model_as_503(monkeypatch):
    def broken_embedder(texts):
        raise RuntimeError("could not reach huggingface.co")

    monkeypatch.setattr(ingest, "embed_texts", broken_embedder)
    await engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/documents",
            files={"file": ("notes.txt", b"Vector databases store embeddings.", "text/plain")},
        )
        listed = (await client.get("/api/v1/documents")).json()
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert "embedding model" in detail and "try again" in detail
    assert "huggingface" not in detail  # internals stay in the server log
    assert listed == []  # nothing half-ingested was left behind
    await engine.dispose()
