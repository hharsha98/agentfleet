"""Resource-ownership/visibility helpers (Phase 12 B).

Centralizes the one visibility rule so every router applies it identically:

  VISIBLE  (read/list/get) — a row is visible to `user` if:
    - row.user_id == user.id            (owner), OR
    - row.user_id IS NULL                (legacy/dev data, global-readable), OR
    - row.is_builtin is True             (Agent only; global-readable)

  MUTABLE  (update/delete) — owner OR legacy-null. NEVER a builtin row, even
  for the "owner" (builtins have no real owner, but the rule is
  unconditional: builtin -> never mutable via the API).

GET/UPDATE/DELETE-by-id routes fetch-then-check: not found OR not visible ->
404 (don't leak existence of another user's row). Visible but not mutable
(i.e. builtin) -> 403.
"""

import uuid

from sqlalchemy import ColumnElement, or_

from app.models import User


def visibility_clause_for_id(
    model, user_id: uuid.UUID | None, *, builtin: bool = False
) -> ColumnElement:
    """WHERE clause for list/count queries, keyed by a raw user id rather
    than a loaded User row: owner OR legacy-null OR (optionally) builtin.

    The single source of truth for the ownership predicate — visibility_
    clause() below delegates to this so there is exactly one definition of
    the rule (see app/tools.py::search_documents, which needed this
    id-based form because tool dispatch only ever carries a user_id, never
    a loaded User).

    `user_id=None` means "no caller identity" — a scheduled run, a
    webhook-triggered run, or the public API-key invoke path used by
    mcp/server.py, none of which have a logged-in user attached to their
    conversation. It does NOT mean "a user who owns nothing": SQLAlchemy
    translates `model.user_id == None` to `IS NULL` (not the always-false
    SQL `= NULL`), so when user_id is None the owner branch and the
    legacy-null branch collapse into the same condition and the clause
    naturally reduces to "only legacy/unowned rows" — never another user's
    private data, and never a blanket "show everything" either.
    """
    clause = or_(model.user_id == user_id, model.user_id.is_(None))
    if builtin:
        clause = or_(clause, model.is_builtin.is_(True))
    return clause


def visibility_clause(model, user: User, *, builtin: bool = False) -> ColumnElement:
    """WHERE clause for list/count queries: owner OR legacy-null OR
    (optionally) builtin."""
    return visibility_clause_for_id(model, user.id, builtin=builtin)


def is_visible(row, user: User, *, builtin: bool = False) -> bool:
    if row.user_id == user.id:
        return True
    if row.user_id is None:
        return True
    if builtin and getattr(row, "is_builtin", False):
        return True
    return False


def is_mutable(row, user: User) -> bool:
    """Owner or legacy-null row — NEVER a builtin row."""
    if getattr(row, "is_builtin", False):
        return False
    return row.user_id == user.id or row.user_id is None
