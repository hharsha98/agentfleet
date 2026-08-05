from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

_settings = get_settings()

# Bug 1 (Wave 1): the engine used to be built with zero pool configuration.
# Both eventual deploy targets (Neon, Wave 2; Cloud SQL, Wave 4) scale
# compute to zero when idle, so a pooled connection going stale is the
# expected case, not an edge case.
#
# pool_pre_ping is the load-bearing setting here: it runs a cheap
# "is this connection still alive" check before handing a pooled
# connection to a caller, and transparently reconnects if not. Without it,
# the first request after any idle period gets a confusing
# driver-level connection error instead of just working.
#
# pool_size/max_overflow/pool_recycle/pool_timeout are sourced from
# Settings — see app/config.py's db_pool_* fields for the derived sizing
# arithmetic (kept there, not duplicated here, so there is exactly one
# place to update the numbers).
engine = create_async_engine(
    _settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=_settings.db_pool_size,
    max_overflow=_settings.db_max_overflow,
    pool_recycle=_settings.db_pool_recycle_seconds,
    pool_timeout=_settings.db_pool_timeout_seconds,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
