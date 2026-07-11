"""scheduled runs

Revision ID: 82e61fa596f6
Revises: 86e383c27ea0
Create Date: 2026-07-11 21:57:21.196114

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '82e61fa596f6'
down_revision: Union[str, Sequence[str], None] = '86e383c27ea0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # NOTE: autogenerate also proposed dropping the langgraph checkpointer
    # tables (checkpoints/checkpoint_blobs/checkpoint_writes/checkpoint_migrations)
    # and the analytics_sales/analytics_customers demo tables — those are
    # created outside SQLAlchemy models.py (by langgraph-checkpoint-postgres
    # and scripts/seed_analytics.py respectively), so they aren't part of
    # Base.metadata and autogenerate treats them as "removed". Stripped that
    # out by hand; this migration only adds scheduled_runs.
    op.create_table(
        "scheduled_runs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("cron", sa.String(length=120), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("scheduled_runs")
