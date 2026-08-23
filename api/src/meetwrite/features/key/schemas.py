"""Request and response models for /key."""

from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field


def _clean_key(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("key must not be blank")
    return value


class KeyUpdate(BaseModel):
    """The OpenAI API key to store. The value never appears in a response."""

    key: Annotated[str, Field(max_length=200), AfterValidator(_clean_key)]


class KeyStatus(BaseModel):
    """Whether a key is stored — a boolean only, never the key."""

    set: bool
