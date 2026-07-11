"""Structured JSON logging with per-request correlation IDs.

setup_logging() configures the root logger to emit one JSON object per log
line: {"ts", "level", "logger", "msg", "request_id"}. request_id comes from
a ContextVar so any log call made while handling a request is automatically
tagged with that request's ID, without threading it through every function
signature. No new dependencies — this is a small hand-rolled formatter.
"""

import json
import logging
from contextvars import ContextVar
from datetime import UTC, datetime

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class JSONFormatter(logging.Formatter):
    """Renders each LogRecord as a single-line JSON object."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        return json.dumps(payload)


def setup_logging(level: int = logging.INFO) -> None:
    """Configure the root logger with the JSON formatter.

    Idempotent: replaces any existing handlers rather than stacking more on
    repeated calls (e.g. module reload during tests).
    """
    root = logging.getLogger()
    root.setLevel(level)

    handler = logging.StreamHandler()
    handler.setFormatter(JSONFormatter())
    root.handlers = [handler]
