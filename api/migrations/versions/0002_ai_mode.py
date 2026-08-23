"""Notes-only mode: per-user AI feature toggle.

Revision ID: 0002_ai_mode
Revises: 0001_initial
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_ai_mode"
down_revision: str | Sequence[str] | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing users keep AI on; only an explicit opt-out turns it off.
    op.add_column(
        "preferences",
        sa.Column("ai_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("preferences", "ai_enabled")
