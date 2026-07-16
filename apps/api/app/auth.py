"""JWT auth (Phase 12 B): verifies Bearer HS256 tokens minted by the web app
(chunk B2) against the shared AUTH_SECRET, and resolves the token's email
claim to a `users` row — created on first call.

Token claims contract (minted by web, verified here):
    { "sub": "<email>", "email": "<email>", "name": "<display name>",
      "iat": <int>, "exp": <int> }, algorithm HS256.

Fails CLOSED: if AUTH_SECRET is unset, every request needing auth gets 503
("auth not configured") rather than silently accepting unsigned/any tokens.
"""

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import User


class AuthError(Exception):
    """Raised for any token decode/validation failure (bad sig, expired,
    wrong alg, missing email claim, malformed token)."""


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.auth_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise AuthError(str(exc)) from exc
    email = payload.get("email")
    if not email or not isinstance(email, str):
        raise AuthError("token missing email claim")
    return payload


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Missing or invalid Authorization header",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _get_or_create_user(session: AsyncSession, email: str, name: str | None) -> User:
    normalized_email = email.strip().lower()
    user = (
        await session.execute(select(User).where(User.email == normalized_email))
    ).scalar_one_or_none()
    if user is not None:
        return user
    user = User(email=normalized_email, name=name)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def current_user(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> User:
    """FastAPI dependency: resolves the caller's `users` row from the
    Authorization: Bearer <jwt> header. Missing/invalid -> 401. Blank
    AUTH_SECRET (not configured) -> 503, fails CLOSED rather than open."""
    settings = get_settings()
    if not settings.auth_secret:
        raise HTTPException(status_code=503, detail="auth not configured")

    authorization = request.headers.get("Authorization")
    if not authorization or not authorization.startswith("Bearer "):
        raise _unauthorized()
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise _unauthorized()

    try:
        payload = decode_token(token)
    except AuthError as exc:
        raise _unauthorized() from exc

    return await _get_or_create_user(session, payload["email"], payload.get("name"))


async def current_user_optional(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> User | None:
    """Same as current_user but returns None when no Authorization header is
    present at all, instead of 401. An invalid/malformed/expired header
    still 401s — this is NOT a "soft-fail" auth check, just a way to allow
    an endpoint to serve both logged-out and logged-in callers.

    Unused today (no B1 route needs it) — reserved for B2's SSR pages that
    render differently for logged-in vs anonymous visitors. Built now per
    spec so B2 doesn't have to touch app/auth.py.
    """
    settings = get_settings()
    if not settings.auth_secret:
        raise HTTPException(status_code=503, detail="auth not configured")

    authorization = request.headers.get("Authorization")
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        raise _unauthorized()
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise _unauthorized()

    try:
        payload = decode_token(token)
    except AuthError as exc:
        raise _unauthorized() from exc

    return await _get_or_create_user(session, payload["email"], payload.get("name"))
