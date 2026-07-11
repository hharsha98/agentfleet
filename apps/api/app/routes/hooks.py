"""Public inbound webhook trigger (Automation platform pillar): an external
system POSTs raw bytes to /api/v1/hooks/{webhook_id} to start a mission run.

Mounted as a SEPARATE router from app/routes/webhooks.py (which owns
/api/v1/webhooks, the management CRUD) so the public trigger path is
/api/v1/hooks/{id}, distinct from the management prefix.

Auth: Bearer <secret>, hash-compared against Webhook.secret_hash (the exact
same pattern as app/routes/public.py's API-key auth). We deliberately do NOT
also support HMAC-signature auth (e.g. X-Signature-256: sha256=<hmac>):
verifying an HMAC requires the raw secret as the HMAC key, and — like
ApiKey — we intentionally store only the secret's hash, never the secret
itself, so there is nothing to key the HMAC with server-side. Bearer-secret
auth over HTTPS (hash-compared, constant-time) is the correct fit for this
hash-only storage model; true HMAC verification would require persisting
the plaintext secret, which we intentionally avoid.
"""

import hashlib
import hmac
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Run, Webhook
from app.services.queue import dispatch_plan

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_BODY_BYTES = 64 * 1024  # 64KB
PAYLOAD_TRUNCATE_CHARS = 1000
PAYLOAD_TOKEN = "{payload}"


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _authenticate(webhook: Webhook, authorization: str | None) -> None:
    # Same 401 for "missing header" and "wrong secret" — avoids letting a
    # caller distinguish "webhook exists, wrong secret" from other failure
    # modes via a different status code (same reasoning as public.py).
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    presented = authorization.removeprefix("Bearer ").strip()
    if not presented:
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    presented_hash = _hash_secret(presented)
    if not hmac.compare_digest(presented_hash, webhook.secret_hash):
        raise HTTPException(status_code=401, detail="Invalid webhook secret")


def _build_goal(goal_template: str, body: bytes) -> str:
    if PAYLOAD_TOKEN not in goal_template:
        return goal_template
    payload_text = body.decode("utf-8", errors="replace")[:PAYLOAD_TRUNCATE_CHARS]
    return goal_template.replace(PAYLOAD_TOKEN, payload_text)


@router.post("/{webhook_id}")
async def trigger_webhook(
    webhook_id: uuid.UUID,
    request: Request,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    webhook = await session.get(Webhook, webhook_id)
    if webhook is None:
        raise HTTPException(status_code=404, detail="Webhook not found")

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body too large (max 64KB)")

    _authenticate(webhook, authorization)

    goal = _build_goal(webhook.goal_template, body)
    run = Run(goal=goal)
    session.add(run)
    await session.commit()
    await session.refresh(run)

    await dispatch_plan(run.id)

    webhook.last_triggered_at = datetime.now(timezone.utc)
    await session.commit()

    logger.info("webhook %s triggered run %s", webhook.id, run.id)
    return {"run_id": str(run.id), "status": "queued"}
