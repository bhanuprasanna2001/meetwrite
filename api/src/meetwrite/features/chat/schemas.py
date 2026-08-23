"""Chat request and response schemas."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from meetwrite.core.time import UtcDateTime


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value


class ChatUpdate(BaseModel):
    title: str | None = Field(max_length=200)


class ChatRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entry_id: int
    title: str | None
    created_at: UtcDateTime


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: UtcDateTime
