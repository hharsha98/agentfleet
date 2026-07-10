from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Document
from app.services.ingest import ingest_document

router = APIRouter()

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # same reasoning as the chat input cap


@router.post("", status_code=201)
async def upload_document(
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 5 MB)")
    try:
        document, chunk_count = await ingest_document(
            session,
            filename=file.filename or "unnamed",
            mime=file.content_type or "application/octet-stream",
            data=data,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"id": str(document.id), "filename": document.filename, "chunks": chunk_count}


@router.get("")
async def list_documents(session: AsyncSession = Depends(get_session)) -> list[dict]:
    documents = (
        (await session.execute(select(Document).order_by(Document.created_at.desc())))
        .scalars()
        .all()
    )
    return [
        {
            "id": str(d.id),
            "filename": d.filename,
            "size_bytes": d.size_bytes,
            "status": d.status,
            "created_at": d.created_at.isoformat(),
        }
        for d in documents
    ]
