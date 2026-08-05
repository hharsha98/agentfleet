"""Bug 1 (Wave 1): app.db.engine must be built with pool_pre_ping on and its
sizing sourced from Settings, not left at SQLAlchemy's bare defaults (no
pre-ping, pool_size=5, max_overflow=10, no recycle).

Inspects the real, already-constructed `app.db.engine` (created once at
import time, same object every test in the suite shares) rather than
building a second engine, since the bug was specifically that the ONE
engine the app actually uses had no pool configuration.
"""

from app.config import get_settings
from app.db import engine


def test_engine_has_pool_pre_ping_enabled() -> None:
    """The load-bearing setting (see db.py's docstring): Neon/Cloud SQL both
    scale compute to zero, so a stale pooled connection is the expected
    case, not an edge case."""
    assert engine.pool._pre_ping is True


def test_engine_pool_sizing_is_sourced_from_settings() -> None:
    """Pool numbers must come from Settings.db_pool_* (app/config.py), not
    be hardcoded in db.py — this is what lets the arq worker configure a
    smaller pool than the API purely via env, with no code branch."""
    settings = get_settings()
    pool = engine.pool

    assert pool.size() == settings.db_pool_size
    assert pool._max_overflow == settings.db_max_overflow
    assert pool._recycle == settings.db_pool_recycle_seconds
    assert pool._timeout == settings.db_pool_timeout_seconds


def test_pool_sizing_defaults_stay_under_the_derived_connection_budget() -> None:
    """Guards the arithmetic documented in app/config.py: at the assumed
    fleet shape (4 API instances + 1 worker instance), peak connections
    must stay under the assumed 25-connection Cloud SQL db-f1-micro cap.
    A future change to these defaults that blows the budget should fail
    this test rather than only be caught by an outage."""
    settings = get_settings()
    assumed_cap = 25
    assumed_max_api_instances = 4

    api_peak = (settings.db_pool_size + settings.db_max_overflow) * assumed_max_api_instances
    assert api_peak < assumed_cap, (
        f"API pool alone ({api_peak}) already exceeds the assumed cap ({assumed_cap}) "
        "with no room left for the worker or an admin connection"
    )
