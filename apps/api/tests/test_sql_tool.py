"""Tests for the sql_query tool (SQL Analytics agent).

Validation tests run offline — sql_query refuses writes/multi-statement
queries BEFORE it ever opens a database connection, so those assertions
need no Postgres. The last test is an integration test against the real
demo schema (Postgres from docker compose must be up).
"""

import asyncio
import json

from app.db import engine
from app.tools import TOOLS, run_tool, specs_for
from scripts.seed_analytics import main as seed_analytics


def test_specs_for_includes_sql_query() -> None:
    specs = specs_for(["sql_query", "not_a_tool"])
    assert specs == [TOOLS["sql_query"]["spec"]]


def test_sql_query_refuses_drop_table() -> None:
    result = asyncio.run(run_tool("sql_query", {"query": "DROP TABLE analytics_sales"}))
    assert result.startswith("Refused")


def test_sql_query_refuses_multi_statement() -> None:
    result = asyncio.run(
        run_tool("sql_query", {"query": "SELECT 1; DELETE FROM analytics_sales"})
    )
    assert result.startswith("Refused")


def test_sql_query_refuses_update() -> None:
    result = asyncio.run(
        run_tool("sql_query", {"query": "UPDATE analytics_sales SET quantity=0"})
    )
    assert result.startswith("Refused")


async def test_sql_query_against_seeded_demo_data() -> None:
    """Integration: requires the Postgres container from docker compose.

    Disposes the engine first so every connection this test's pool hands
    out is created fresh on THIS test's event loop — same reasoning as
    test_evals.py's module docstring (asyncpg connections are bound to the
    event loop that created them, and earlier sync tests in this same
    pytest run drive the shared `app.db.engine` through asyncio.run(),
    which opens/closes its own loop each time).
    """
    await engine.dispose()
    await seed_analytics()
    result = await run_tool(
        "sql_query",
        {
            "query": (
                "SELECT region, SUM(quantity) AS q FROM analytics_sales "
                "GROUP BY region ORDER BY q DESC"
            )
        },
    )
    parsed = json.loads(result)
    assert "columns" in parsed
    assert "rows" in parsed
    assert parsed["row_count"] > 0
