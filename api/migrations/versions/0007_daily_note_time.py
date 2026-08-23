"""Daily note time: the hour today's note lands in its folder.

Revision ID: 0007_daily_note_time
Revises: 0006_images_daily
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlmodel.sql.sqltypes import AutoString

revision: str = "0007_daily_note_time"
down_revision: str | Sequence[str] | None = "0006_images_daily"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing preference rows get the conventional morning time; the field
    # itself is only read when the daily note is enabled.
    op.add_column(
        "preferences",
        sa.Column(
            "daily_note_time",
            AutoString(length=5),
            nullable=False,
            server_default="08:00",
        ),
    )


def downgrade() -> None:
    op.drop_column("preferences", "daily_note_time")
