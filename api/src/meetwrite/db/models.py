"""The complete user-owned persistence model."""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    UniqueConstraint,
    text,
)
from sqlmodel import Field, SQLModel

from meetwrite.core.time import utc_now


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str | None = Field(default=None, max_length=100)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Preferences(SQLModel, table=True):
    __tablename__ = "preferences"
    __table_args__ = (
        CheckConstraint("theme IN ('light', 'dark')", name="ck_preferences_theme"),
        CheckConstraint(
            "note_font IN ('lato', 'arial', 'serif', 'mono')",
            name="ck_preferences_note_font",
        ),
        CheckConstraint(
            "note_font_size BETWEEN 16 AND 32 AND note_font_size % 2 = 0",
            name="ck_preferences_note_font_size",
        ),
    )

    user_id: int = Field(foreign_key="user.id", primary_key=True, ondelete="CASCADE")
    theme: str = Field(default="light", max_length=20)
    note_font: str = Field(default="lato", max_length=20)
    note_font_size: int = Field(default=16)
    enter_meeting_on_record: bool = Field(default=False)
    ai_enabled: bool = Field(default=True)
    # The daily note is get-or-created on launch; the folder id is loose on
    # purpose (no FK) so deleting the folder never blocks — the reader falls
    # back to Inbox when the folder is gone.
    daily_note_enabled: bool = Field(default=False)
    daily_note_folder_id: int | None = Field(default=None)
    # Local HH:MM when the daily note is created while the app is open;
    # launching later the same day get-or-creates it too.
    daily_note_time: str = Field(default="08:00", max_length=5)


class Folder(SQLModel, table=True):
    """One exclusive home for notes. A single level — folders never nest.

    `user_id, name` is unique so two folders cannot share a name, and the
    partial index `uq_folder_one_inbox` guarantees at most one Inbox per user.
    """

    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_folder_id_user"),
        UniqueConstraint("user_id", "name", name="uq_folder_user_name"),
        Index(
            "uq_folder_one_inbox",
            "user_id",
            unique=True,
            sqlite_where=text("is_inbox = 1"),
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    name: str = Field(max_length=100)
    is_inbox: bool = Field(default=False)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Entry(SQLModel, table=True):
    # Every note belongs to exactly one folder; deleting the folder is
    # blocked by RESTRICT until the service has moved the notes to Inbox.
    # The partial index below makes the daily-note get-or-create idempotent:
    # at most one note per (user, day), ordinary notes never collide.
    __table_args__ = (
        UniqueConstraint("id", "user_id"),
        ForeignKeyConstraint(
            ["folder_id", "user_id"],
            ["folder.id", "folder.user_id"],
            name="fk_entry_folder",
            ondelete="RESTRICT",
        ),
        Index(
            "uq_entry_daily_date",
            "user_id",
            "daily_date",
            unique=True,
            sqlite_where=text("daily_date IS NOT NULL"),
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    folder_id: int = Field(index=True)
    title: str | None = Field(default=None, max_length=200)
    note_md: str | None = None
    # The client's local date (YYYY-MM-DD) for the one note that represents
    # that day; null for every ordinary note.
    daily_date: str | None = Field(default=None, max_length=10)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class EntryImage(SQLModel, table=True):
    """One picture attached to a note. The bytes live in the same row so
    deleting the note deletes its images in the same transaction."""

    __tablename__ = "entry_image"
    __table_args__ = (
        ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    entry_id: int = Field(index=True)
    title: str | None = Field(default=None, max_length=200)
    mime_type: str = Field(max_length=100)
    data: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Template(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "normalized_name"),)

    user_id: int = Field(foreign_key="user.id", primary_key=True, ondelete="CASCADE")
    id: str = Field(primary_key=True, max_length=80)
    name: str = Field(max_length=100)
    normalized_name: str = Field(max_length=100)
    description: str = Field(default="", max_length=300)
    instructions: str = Field(default="", max_length=4_000)
    is_builtin: bool = Field(default=False)
    sort_order: int | None = Field(default=None)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class DictionaryTerm(SQLModel, table=True):
    """One word the user wants transcription to recognize more reliably."""

    __tablename__ = "dictionary_term"
    __table_args__ = (UniqueConstraint("user_id", "normalized_value"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    value: str = Field(max_length=100)
    normalized_value: str = Field(max_length=100)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Tag(SQLModel, table=True):
    """One user-owned label. `normalized_value` (lowercased) is the unique
    key; `value` keeps the casing the user typed."""

    __table_args__ = (
        UniqueConstraint("user_id", "normalized_value"),
        # Target of the composite entry_tag foreign key.
        UniqueConstraint("id", "user_id", name="uq_tag_id_user"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    value: str = Field(max_length=60)
    normalized_value: str = Field(max_length=60)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class EntryTag(SQLModel, table=True):
    """The many-to-many join between a note and its tags, owned by the same
    user as both — deleting either end cascades the join away."""

    __tablename__ = "entry_tag"
    __table_args__ = (
        ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["tag_id", "user_id"],
            ["tag.id", "tag.user_id"],
            ondelete="CASCADE",
        ),
    )

    entry_id: int = Field(primary_key=True)
    tag_id: int = Field(primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")


class TranscriptLine(SQLModel, table=True):
    __tablename__ = "transcript_line"
    __table_args__ = (
        ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("entry_id", "sequence"),
        CheckConstraint("source IN ('me', 'them')", name="ck_transcript_line_source"),
        CheckConstraint("sequence > 0", name="ck_transcript_line_sequence"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    entry_id: int = Field(index=True)
    sequence: int
    source: str = Field(max_length=8)
    text: str
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class EnhancedVersion(SQLModel, table=True):
    __tablename__ = "enhanced_version"
    __table_args__ = (
        ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    entry_id: int = Field(index=True)
    title: str | None = Field(default=None, max_length=200)
    content: str
    template_id: str | None = Field(default=None, max_length=80)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Chat(SQLModel, table=True):
    __table_args__ = (
        ForeignKeyConstraint(
            ["entry_id", "user_id"],
            ["entry.id", "entry.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "user_id"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    entry_id: int = Field(index=True)
    title: str | None = Field(default=None, max_length=200)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Message(SQLModel, table=True):
    __table_args__ = (
        ForeignKeyConstraint(
            ["chat_id", "user_id"],
            ["chat.id", "chat.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("role IN ('user', 'assistant')", name="ck_message_role"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    chat_id: int = Field(index=True)
    role: str = Field(max_length=20)
    content: str
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
