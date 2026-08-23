"""Folders: one exclusive home per note, plus one protected Inbox per user.

SQLite cannot add constraints to an existing table, so the `entry` changes
go through Alembic batch mode (copy-and-move). The backfill between the two
batches is two plain SQL statements: one Inbox per user, every note moved in.

Revision ID: 0004_folders
Revises: 0003_dictionary
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlmodel.sql.sqltypes import AutoString

revision: str = "0004_folders"
down_revision: str | Sequence[str] | None = "0003_dictionary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INBOX_NAME = "Inbox"


def upgrade() -> None:
    op.create_table(
        "folder",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", AutoString(length=100), nullable=False),
        sa.Column("is_inbox", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        # (id, user_id) is the target of the composite entry foreign key.
        sa.UniqueConstraint("id", "user_id", name="uq_folder_id_user"),
        sa.UniqueConstraint("user_id", "name", name="uq_folder_user_name"),
    )
    op.create_index("ix_folder_user_id", "folder", ["user_id"])
    # At most one Inbox per user, enforced by the database itself.
    op.create_index(
        "uq_folder_one_inbox",
        "folder",
        ["user_id"],
        unique=True,
        sqlite_where=sa.text("is_inbox = 1"),
    )

    # Give every note a home before the column becomes required.
    with op.batch_alter_table("entry") as batch:
        batch.add_column(sa.Column("folder_id", sa.Integer(), nullable=True))
        batch.create_index("ix_entry_folder_id", ["folder_id"])

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "INSERT INTO folder (user_id, name, is_inbox, created_at) "
            "SELECT id, :name, 1, :created_at FROM user"
        ),
        {"name": INBOX_NAME, "created_at": datetime.now(UTC)},
    )
    bind.execute(
        sa.text(
            "UPDATE entry SET folder_id = ("
            " SELECT id FROM folder"
            " WHERE folder.user_id = entry.user_id AND folder.is_inbox = 1)"
        )
    )

    # Populated now: enforce NOT NULL and the ownership foreign key. A move
    # between folders only ever changes folder_id; deleting a folder is
    # blocked by RESTRICT until the service has moved its notes to Inbox.
    with op.batch_alter_table("entry") as batch:
        batch.alter_column("folder_id", existing_type=sa.Integer(), nullable=False)
        batch.create_foreign_key(
            "fk_entry_folder",
            "folder",
            ["folder_id", "user_id"],
            ["id", "user_id"],
            ondelete="RESTRICT",
        )


def downgrade() -> None:
    with op.batch_alter_table("entry") as batch:
        batch.drop_constraint("fk_entry_folder", type_="foreignkey")
        batch.drop_index("ix_entry_folder_id")
        batch.drop_column("folder_id")
    op.drop_index("uq_folder_one_inbox", table_name="folder")
    op.drop_index("ix_folder_user_id", table_name="folder")
    op.drop_table("folder")
