"""Tags: user-scoped labels attached to entries, normalized and deduplicated.

Revision ID: 0005_tags
Revises: 0004_folders
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlmodel.sql.sqltypes import AutoString

revision: str = "0005_tags"
down_revision: str | Sequence[str] | None = "0004_folders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tag",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("value", AutoString(length=60), nullable=False),
        sa.Column("normalized_value", AutoString(length=60), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "normalized_value"),
        # Target of the composite entry_tag foreign key.
        sa.UniqueConstraint("id", "user_id", name="uq_tag_id_user"),
    )
    op.create_index("ix_tag_user_id", "tag", ["user_id"])

    op.create_table(
        "entry_tag",
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tag_id", "user_id"],
            ["tag.id", "tag.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("entry_id", "tag_id"),
    )
    op.create_index("ix_entry_tag_user_id", "entry_tag", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_entry_tag_user_id", table_name="entry_tag")
    op.drop_table("entry_tag")
    op.drop_index("ix_tag_user_id", table_name="tag")
    op.drop_table("tag")
