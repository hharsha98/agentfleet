"""run task superseded_by for repair re-planning

Revision ID: b51d0f1cf233
Revises: fae1d462a303
Create Date: 2026-07-29 08:49:16.792783

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b51d0f1cf233'
down_revision: Union[str, Sequence[str], None] = 'fae1d462a303'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable, no FK: `superseded_by` is the ordinal (int) of the RunTask
    # that replaces this one — an in-run position, not a row id — same
    # convention as `depends_on` (JSONB list of ordinals) already uses. No
    # constraint to name here, so nothing for autogenerate to leave as
    # `None` (see NAMING_CONVENTION in app/models.py for why that matters).
    op.add_column('run_tasks', sa.Column('superseded_by', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('run_tasks', 'superseded_by')
