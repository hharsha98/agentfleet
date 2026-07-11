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

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Webhook

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
async def list_webhooks(session: AsyncSession = Depends(get_session)) -> list[dict]:
    webhooks = (
        (await session.execute(select(Webhook).order_by(Webhook.created_at.desc())))
        .scalars()
        .all()
    )
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
) -> dict:
    webhook = await session.get(Webhook, webhook_id)
    if webhook is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await session.delete(webhook)
    await session.commit()
    return {"ok": True}
