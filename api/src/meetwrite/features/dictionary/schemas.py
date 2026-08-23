"""Request and response models for /dictionary."""

from pydantic import BaseModel, ConfigDict, Field

from meetwrite.core.time import UtcDateTime
from meetwrite.features.dictionary.services import DICTIONARY_MAX_TERMS


class DictionaryTermsCreate(BaseModel):
    """Terms parsed from the UI's one-per-line input."""

    model_config = ConfigDict(extra="forbid")

    values: list[str] = Field(min_length=1, max_length=DICTIONARY_MAX_TERMS)


class DictionaryTermRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    value: str
    created_at: UtcDateTime
