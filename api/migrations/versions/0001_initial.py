"""Initial user-owned schema.

Revision ID: 0001_initial
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlmodel.sql.sqltypes import AutoString

revision: str = "0001_initial"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", AutoString(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "preferences",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("theme", AutoString(length=20), nullable=False),
        sa.Column("note_font", AutoString(length=20), nullable=False),
        sa.Column("note_font_size", sa.Integer(), nullable=False),
        sa.Column("enter_meeting_on_record", sa.Boolean(), nullable=False),
        sa.CheckConstraint("theme IN ('light', 'dark')", name="ck_preferences_theme"),
        sa.CheckConstraint(
            "note_font IN ('lato', 'arial', 'serif', 'mono')",
            name="ck_preferences_note_font",
        ),
        sa.CheckConstraint(
            "note_font_size BETWEEN 16 AND 32 AND note_font_size % 2 = 0",
            name="ck_preferences_note_font_size",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "entry",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", AutoString(length=200), nullable=True),
        sa.Column("note_md", AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id"),
    )
    op.create_index("ix_entry_user_id", "entry", ["user_id"])
    op.create_table(
        "template",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("id", AutoString(length=80), nullable=False),
        sa.Column("name", AutoString(length=100), nullable=False),
        sa.Column("normalized_name", AutoString(length=100), nullable=False),
        sa.Column("description", AutoString(length=300), nullable=False),
        sa.Column("instructions", AutoString(length=4000), nullable=False),
        sa.Column("is_builtin", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "id"),
        sa.UniqueConstraint("user_id", "normalized_name"),
    )
    op.create_table(
        "transcript_line",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("source", AutoString(length=8), nullable=False),
        sa.Column("text", AutoString(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source IN ('me', 'them')", name="ck_transcript_line_source"
        ),
        sa.CheckConstraint("sequence > 0", name="ck_transcript_line_sequence"),
        sa.ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entry_id", "sequence"),
    )
    op.create_index("ix_transcript_line_entry_id", "transcript_line", ["entry_id"])
    op.create_index("ix_transcript_line_user_id", "transcript_line", ["user_id"])
    op.create_table(
        "enhanced_version",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("title", AutoString(length=200), nullable=True),
        sa.Column("content", AutoString(), nullable=False),
        sa.Column("template_id", AutoString(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_enhanced_version_entry_id", "enhanced_version", ["entry_id"])
    op.create_index("ix_enhanced_version_user_id", "enhanced_version", ["user_id"])
    op.create_table(
        "chat",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("title", AutoString(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id"),
    )
    op.create_index("ix_chat_entry_id", "chat", ["entry_id"])
    op.create_index("ix_chat_user_id", "chat", ["user_id"])
    op.create_table(
        "message",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.Integer(), nullable=False),
        sa.Column("role", AutoString(length=20), nullable=False),
        sa.Column("content", AutoString(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant')", name="ck_message_role"),
        sa.ForeignKeyConstraint(
            ["chat_id", "user_id"],
            ["chat.id", "chat.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_message_chat_id", "message", ["chat_id"])
    op.create_index("ix_message_user_id", "message", ["user_id"])


def downgrade() -> None:
    op.drop_table("message")
    op.drop_table("chat")
    op.drop_table("enhanced_version")
    op.drop_table("transcript_line")
    op.drop_table("template")
    op.drop_table("entry")
    op.drop_table("preferences")
    op.drop_table("user")
