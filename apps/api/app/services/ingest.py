"""Document ingestion: extract text, chunk, embed locally, store in pgvector.

Embeddings run on-CPU via fastembed (ARCHITECTURE.md ADR-008) — no API cost,
no data leaves the machine. The model (~130MB) downloads once on first use.
"""

import asyncio
import io
import logging

from fastembed import TextEmbedding
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chunk, Document

logger = logging.getLogger(__name__)

EMBED_MODEL = "BAAI/bge-small-en-v1.5"
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150

_embedder: TextEmbedding | None = None


def _get_embedder() -> TextEmbedding:
    global _embedder
    if _embedder is None:
        logger.info("loading embedding model %s (first run downloads ~130MB)", EMBED_MODEL)
        _embedder = TextEmbedding(model_name=EMBED_MODEL)
    return _embedder


def extract_text(filename: str, data: bytes) -> str:
    if filename.lower().endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    return data.decode("utf-8", errors="replace")


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Sliding character window: simple, predictable, and easy to test."""
    text = text.strip()
    if not text:
        return []
    step = size - overlap
    chunks: list[str] = []
    for start in range(0, len(text), step):
        piece = text[start : start + size].strip()
        if piece:
            chunks.append(piece)
        if start + size >= len(text):
            break
    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    return [vector.tolist() for vector in _get_embedder().embed(texts)]


async def ingest_document(
    session: AsyncSession, filename: str, mime: str, data: bytes
) -> tuple[Document, int]:
    text = extract_text(filename, data)
    pieces = chunk_text(text)
    if not pieces:
        raise ValueError("No extractable text in file")
    # CPU-bound embedding runs off the event loop so requests keep flowing.
    vectors = await asyncio.to_thread(embed_texts, pieces)

    document = Document(filename=filename, mime=mime, size_bytes=len(data), status="ready")
    session.add(document)
    await session.flush()  # assigns document.id
    for i, (piece, vector) in enumerate(zip(pieces, vectors)):
        session.add(Chunk(document_id=document.id, ordinal=i, text=piece, embedding=vector))
    await session.commit()
    await session.refresh(document)
    return document, len(pieces)
