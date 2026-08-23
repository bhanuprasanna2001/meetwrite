"""Request and response models for /entries."""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

from meetwrite.core.time import UtcDateTime


class EntryCreate(BaseModel):
    """A new blank note. When `folder_id` is omitted the note lands in Inbox."""

    folder_id: int | None = None


class EntryUpdate(BaseModel):
    """The fields a note edit can change. `folder_id` moves the note."""

    title: str | None = Field(default=None, max_length=200)
    note_md: str | None = Field(default=None, max_length=1_000_000)
    folder_id: int | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or None


class OutlineImage(BaseModel):
    """One image of a note — the id for the file endpoint plus its title."""

    id: int
    title: str | None


class EntrySummary(BaseModel):
    """One history row — just enough to list, plus a one-line preview, its
    tags (for folder chips and filtering), and its images (for the folder
    view's thumbnails) — no extra requests."""

    id: int
    folder_id: int
    title: str | None
    preview: str
    tags: list[str]
    images: list[OutlineImage]
    created_at: UtcDateTime
    updated_at: UtcDateTime


class EntryRead(BaseModel):
    """One full entry: the human notes, the transcript, and the note's
    images. Enhanced versions are read from /entries/{id}/enhanced-versions."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_id: int
    title: str | None
    note_md: str | None
    transcript: str | None
    images: list[OutlineImage]
    created_at: UtcDateTime
    updated_at: UtcDateTime


class OutlineChat(BaseModel):
    """One chat row of a note's sidebar children."""

    id: int
    title: str | None


class EntryOutline(BaseModel):
    """The compact sidebar outline: transcript presence, chat titles, and
    the note's images. Never the transcript, messages, or image bytes."""

    has_transcript: bool
    chats: list[OutlineChat]
    images: list[OutlineImage]


class EntryImageRead(BaseModel):
    """One image's metadata — never the bytes, which /images/{id} serves."""

    id: int
    entry_id: int
    title: str | None
    mime_type: str
    created_at: UtcDateTime


class EntryImageTitleUpdate(BaseModel):
    """A new title for one image. Normalized like a note title."""

    title: str | None = Field(default=None, max_length=200)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or None


class DailyNoteCreate(BaseModel):
    """The client's local date and the folder to hold today's note (Inbox
    when omitted). The date must be a real calendar date, never a bare
    string the user could not have meant."""

    date: str
    folder_id: int | None = None

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        # Exactly one accepted shape: ten characters, YYYY-MM-DD, and a real
        # calendar day — the client's local date, never a guess.
        if len(value) != 10:
            raise ValueError("date must be a real YYYY-MM-DD date")
        try:
            date.fromisoformat(value)
        except ValueError:
            raise ValueError("date must be a real YYYY-MM-DD date") from None
        return value


class DailyNoteRead(BaseModel):
    """Today's note, plus whether this call created it — the client can
    tell "opened today's note" from "made today's note" in one response."""

    entry: EntryRead
    created: bool


class TagReplace(BaseModel):
    """The complete replacement set of tags for one note. Values are
    normalized server-side; there is no count cap."""

    tags: list[str] = Field(default_factory=list)


class TagRead(BaseModel):
    """A note's tags after a replace — the server's normalized truth."""

    tags: list[str]


class TagRename(BaseModel):
    """A tag's new display value. Normalized server-side, like on save."""

    value: str


class AudioAppend(BaseModel):
    """One chunk of recording audio: base64 PCM16, 24 kHz, mono."""

    audio: str = Field(min_length=1)


class AudioRead(BaseModel):
    """The saved recording's length, in seconds (0 when there is none yet)."""

    duration_s: float
