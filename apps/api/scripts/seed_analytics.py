"""Seed demo analytics data for the SQL Analytics agent. Idempotent: run any
number of times — if analytics_sales already has rows, the insert is skipped
entirely (both tables are seeded together, so checking one is enough).

Data is DETERMINISTIC (hardcoded regions/products/customers plus a fixed
formula for quantity/price/dates) — no `random`, no wall-clock — so the
demo dataset, and any answer an agent gives about it, is reproducible across
runs and machines.

These tables live in the MAIN app Postgres (not a separate database); the
sql_query tool defaults to the same connection unless ANALYTICS_DATABASE_URL
is set.

Usage: uv run python -m scripts.seed_analytics
"""

import asyncio
from datetime import date, timedelta

from sqlalchemy import text

from app.db import engine

REGIONS = ["EMEA", "AMER", "APAC", "LATAM"]
PRODUCTS = ["Widget", "Gadget", "Gizmo", "Doohickey", "Thingamajig"]
PLANS = ["Free", "Pro", "Enterprise"]

_SALES_BASE_DATE = date(2025, 1, 1)
_CUSTOMERS_BASE_DATE = date(2025, 1, 15)

CREATE_SALES = """
CREATE TABLE IF NOT EXISTS analytics_sales (
    id INTEGER PRIMARY KEY,
    region TEXT NOT NULL,
    product TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    sale_date DATE NOT NULL
)
"""

CREATE_CUSTOMERS = """
CREATE TABLE IF NOT EXISTS analytics_customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    signup_date DATE NOT NULL,
    plan TEXT NOT NULL
)
"""


def _build_sales_rows() -> list[dict]:
    """4 regions x 5 products x 3 instances = 60 deterministic rows."""
    rows: list[dict] = []
    row_id = 1
    for region_idx, region in enumerate(REGIONS):
        for product_idx, product in enumerate(PRODUCTS):
            for i in range(3):
                offset_days = (region_idx * 5 + product_idx) * 7 + i * 3
                quantity = 5 + (region_idx + product_idx + i * 2) % 20
                unit_price = round(10.0 + product_idx * 7.5 + i * 2.25, 2)
                rows.append(
                    {
                        "id": row_id,
                        "region": region,
                        "product": product,
                        "quantity": quantity,
                        "unit_price": unit_price,
                        "sale_date": _SALES_BASE_DATE + timedelta(days=offset_days),
                    }
                )
                row_id += 1
    return rows


def _build_customer_rows() -> list[dict]:
    """20 deterministic customers spread across regions/plans."""
    rows: list[dict] = []
    for i in range(20):
        region = REGIONS[i % len(REGIONS)]
        plan = PLANS[i % len(PLANS)]
        rows.append(
            {
                "id": i + 1,
                "name": f"Customer {i + 1:02d}",
                "region": region,
                "signup_date": _CUSTOMERS_BASE_DATE + timedelta(days=i * 11),
                "plan": plan,
            }
        )
    return rows


async def main() -> None:
    async with engine.begin() as conn:
        await conn.execute(text(CREATE_SALES))
        await conn.execute(text(CREATE_CUSTOMERS))

        sales_count = (
            await conn.execute(text("SELECT COUNT(*) FROM analytics_sales"))
        ).scalar_one()

        if sales_count == 0:
            sales_rows = _build_sales_rows()
            await conn.execute(
                text(
                    "INSERT INTO analytics_sales "
                    "(id, region, product, quantity, unit_price, sale_date) "
                    "VALUES (:id, :region, :product, :quantity, :unit_price, :sale_date)"
                ),
                sales_rows,
            )
            customer_rows = _build_customer_rows()
            await conn.execute(
                text(
                    "INSERT INTO analytics_customers "
                    "(id, name, region, signup_date, plan) "
                    "VALUES (:id, :name, :region, :signup_date, :plan)"
                ),
                customer_rows,
            )
            print(
                f"Seeded analytics_sales: {len(sales_rows)} rows, "
                f"analytics_customers: {len(customer_rows)} rows"
            )
        else:
            customers_count = (
                await conn.execute(text("SELECT COUNT(*) FROM analytics_customers"))
            ).scalar_one()
            print(
                f"Skipped seeding — already present "
                f"(analytics_sales: {sales_count} rows, analytics_customers: {customers_count} rows)"
            )


if __name__ == "__main__":
    asyncio.run(main())
