"""Sentry error monitoring — DSN-gated, no-op when unset.

No Sentry DSN is configured in dev/CI (and none is expected to be). With a
blank SENTRY_DSN (the default), init_sentry() logs one line and returns
False; sentry-sdk is never initialized, so nothing about existing request
handling, logging, or SSE streaming changes. This mirrors the graceful
degradation pattern used for the voice feature's VAPI_PUBLIC_KEY.

When a DSN *is* set, Sentry events are tagged with the current request's
correlation ID (see app.logging_config.request_id_var) so a Sentry event
can be matched to the exact structured log lines from the same request.
"""

import logging

import sentry_sdk
from sentry_sdk.types import Event, Hint

from app.config import get_settings
from app.logging_config import request_id_var

logger = logging.getLogger("app.observability")


def attach_request_id(event: Event, hint: Hint) -> Event | None:
    """Sentry before_send hook: tag the event with the in-flight request ID.

    request_id_var defaults to "-" outside of a request (e.g. background
    jobs), in which case no tag is added. Always returns the event
    unchanged otherwise — this hook only adds a tag, it never drops events.
    """
    request_id = request_id_var.get()
    if request_id and request_id != "-":
        event.setdefault("tags", {})["request_id"] = request_id
    return event


def init_sentry() -> bool:
    """Initialize Sentry if settings.sentry_dsn is set; no-op otherwise.

    Returns True if Sentry was initialized, False if it was skipped. Call
    once, right after setup_logging(), so early startup errors are still
    captured once a DSN is configured.
    """
    settings = get_settings()
    if not settings.sentry_dsn:
        logger.info("sentry disabled (no DSN)")
        return False

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        send_default_pii=False,
        traces_sample_rate=0.1,
        environment=settings.sentry_environment,
        before_send=attach_request_id,
    )
    return True
