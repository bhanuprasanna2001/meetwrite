"""Folders: one exclusive home per note, with one protected Inbox."""

from pydantic import BaseModel, Field, field_validator


class FolderCreate(BaseModel):
    """A new folder's name — trimmed and collapsed before it is stored."""

    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Folder name cannot be blank")
        return cleaned


class FolderUpdate(FolderCreate):
    """Same shape as create — renaming follows the same rules."""


class FolderRead(BaseModel):
    """One folder, exactly as the sidebar needs it."""

    id: int
    name: str
    is_inbox: bool
