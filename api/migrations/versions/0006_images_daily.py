"""Entry images and the daily note: attachments and the one-note-per-day rule.

Revision ID: 0006_images_daily
Revises: 0005_tags
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlmodel.sql.sqltypes import AutoString

revision: str = "0006_images_daily"
down_revision: str | Sequence[str] | None = "0005_tags"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # SQLite cannot ALTER-ADD constraints, so daily_date arrives nullable
    # and the uniqueness rule lives in a partial index that ignores nulls.
    op.add_column(
        "entry",
        sa.Column("daily_date", AutoString(length=10), nullable=True),
    )
    op.create_index(
        "uq_entry_daily_date",
        "entry",
        ["user_id", "daily_date"],
        unique=True,
        sqlite_where=sa.text("daily_date IS NOT NULL"),
    )

    op.create_table(
        "entry_image",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("title", AutoString(length=200), nullable=True),
        sa.Column("mime_type", AutoString(length=100), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_entry_image_user_id", "entry_image", ["user_id"])
    op.create_index("ix_entry_image_entry_id", "entry_image", ["entry_id"])

    # Preferences rows already exist, so the new columns need server
    # defaults or nullability; enabled defaults to off.
    op.add_column(
        "preferences",
        sa.Column(
            "daily_note_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "preferences",
        sa.Column("daily_note_folder_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("preferences", "daily_note_folder_id")
    op.drop_column("preferences", "daily_note_enabled")
    op.drop_index("ix_entry_image_entry_id", table_name="entry_image")
    op.drop_index("ix_entry_image_user_id", table_name="entry_image")
    op.drop_table("entry_image")
    op.drop_index("uq_entry_daily_date", table_name="entry")
    op.drop_column("entry", "daily_date")
