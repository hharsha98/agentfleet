"""Inbound webhook management (Automation platform pillar, sibling of
schedules.py). A webhook is a goal template that fires when an external
system POSTs to its trigger path (see app/routes/hooks.py for the public
trigger endpoint).

Secrets follow the exact same pattern as app/routes/keys.py's ApiKey: only
the sha256 hash is persisted, the full secret is returned exactly once, in
the create response, and can never be recovered again if lost.
"""

import hashlib
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db import get_session
from app.models import User, Webhook

router = APIRouter()

SECRET_PREFIX = "whk_"


class WebhookCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    goal_template: str = Field(min_length=1, max_length=2000)


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


@router.post("", status_code=201)
async def create_webhook(
    payload: WebhookCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> dict:
    secret = SECRET_PREFIX + secrets.token_hex(24)
    webhook = Webhook(
        name=payload.name,
        goal_template=payload.goal_template,
        secret_prefix=secret[:12],
        secret_hash=_hash_secret(secret),
    )
    session.add(webhook)
    await session.commit()
    await session.refresh(webhook)

    # The full secret is returned ONLY here — it is never stored (only its
    # hash is), and can never be shown again after this response.
    return {
        "id": str(webhook.id),
        "name": webhook.name,
        "goal_template": webhook.goal_template,
        "trigger_path": f"/api/v1/hooks/{webhook.id}",
        "secret": secret,
        "created_at": webhook.created_at.isoformat(),
    }


@router.get("")
async def list_webhooks(
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> list[dict]:
    total = (await session.execute(select(func.count()).select_from(Webhook))).scalar_one()
    webhooks = (
        (
            await session.execute(
                select(Webhook)
                .order_by(Webhook.created_at.desc(), Webhook.id)
                .offset(offset)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    response.headers["X-Total-Count"] = str(total)
    # NEVER include secret_hash or the full secret here.
    return [
        {
            "id": str(w.id),
            "name": w.name,
            "goal_template": w.goal_template,
            "secret_prefix": w.secret_prefix,
            "last_triggered_at": w.last_triggered_at.isoformat() if w.last_triggered_at else None,
            "created_at": w.created_at.isoformat(),
        }
        for w in webhooks
    ]


@router.delete("/{webhook_id}")
async def delete_webhook(
    webhook_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> dict:
    webhook = await session.get(Webhook, webhook_id)
    if webhook is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await session.delete(webhook)
    await session.commit()
    return {"ok": True}
