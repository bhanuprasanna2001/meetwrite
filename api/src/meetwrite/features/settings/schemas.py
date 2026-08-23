"""Request and response models for /settings."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Theme = Literal["light", "dark"]
NoteFont = Literal["lato", "arial", "serif", "mono"]


class SettingsUpdate(BaseModel):
    """The preferences to save (all of them, like the /me PUT)."""

    theme: Theme
    note_font: NoteFont
    note_font_size: int = Field(ge=16, le=32, multiple_of=2)
    enter_meeting_on_record: bool
    ai_enabled: bool
    # The daily note lands in this folder (null = Inbox). The reference is
    # loose — deleting the folder clears it — so saving never fails on it.
    daily_note_enabled: bool
    daily_note_folder_id: int | None = None
    # Local HH:MM the note is created at while the app is open.
    daily_note_time: str = Field(
        default="08:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$"
    )


class SettingsRead(BaseModel):
    """The current preferences."""

    model_config = ConfigDict(from_attributes=True)

    theme: Theme
    note_font: NoteFont
    note_font_size: int
    enter_meeting_on_record: bool
    ai_enabled: bool
    daily_note_enabled: bool
    daily_note_folder_id: int | None
    daily_note_time: str
