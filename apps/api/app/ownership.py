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

from sqlalchemy import ColumnElement, or_

from app.models import User


def visibility_clause(model, user: User, *, builtin: bool = False) -> ColumnElement:
    """WHERE clause for list/count queries: owner OR legacy-null OR
    (optionally) builtin."""
    clause = or_(model.user_id == user.id, model.user_id.is_(None))
    if builtin:
        clause = or_(clause, model.is_builtin.is_(True))
    return clause


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
