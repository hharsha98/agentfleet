"""run error: plain-English reason a mission failed

Revision ID: c7d2e4a91b30
Revises: b51d0f1cf233
Create Date: 2026-11-18 19:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d2e4a91b30'
down_revision: Union[str, Sequence[str], None] = 'b51d0f1cf233'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable text, no constraint: set only when a whole run fails before
    # its tasks can say why themselves (e.g. planning could not reach the
    # provider). Before this, the reason went to the server log only and the
    # board showed a bare "failed" with 0 tasks.
    op.add_column('runs', sa.Column('error', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('runs', 'error')
