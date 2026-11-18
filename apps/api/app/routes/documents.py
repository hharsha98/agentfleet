import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db import get_session
from app.models import Document, User
from app.ownership import visibility_clause
from app.ratelimit import limiter, upload_limit
from app.services.ingest import EmbeddingUnavailableError, ingest_document

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # same reasoning as the chat input cap


@router.post("", status_code=201)
@limiter.limit(upload_limit)
async def upload_document(
    request: Request,
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
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
            user_id=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except EmbeddingUnavailableError as exc:
        # Used to surface as a bare 500 "Internal Server Error", which the
        # page then failed to parse as JSON and showed as a SyntaxError.
        logger.exception("embedding model unavailable during upload")
        raise HTTPException(
            status_code=503,
            detail=(
                "Couldn't process the document: the embedding model isn't available on "
                "this server right now (it downloads about 130 MB the first time). "
                "Please try again in a minute."
            ),
        ) from exc
    return {"id": str(document.id), "filename": document.filename, "chunks": chunk_count}


@router.get("")
async def list_documents(
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> list[dict]:
    visible = visibility_clause(Document, user)
    total = (
        await session.execute(select(func.count()).select_from(Document).where(visible))
    ).scalar_one()
    documents = (
        (
            await session.execute(
                select(Document)
                .where(visible)
                .order_by(Document.created_at.desc(), Document.id)
                .offset(offset)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    response.headers["X-Total-Count"] = str(total)
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
