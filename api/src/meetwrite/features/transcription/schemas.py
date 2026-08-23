"""Response models for the transcription feature."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from meetwrite.core.audio import MAX_REALTIME_CHUNK_BASE64_CHARACTERS
from meetwrite.core.time import UtcDateTime


class AudioFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["me", "them"]
    audio: str = Field(min_length=1, max_length=MAX_REALTIME_CHUNK_BASE64_CHARACTERS)


class StopFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["stop"]


class TranscriptLineRead(BaseModel):
    """One finished utterance — the transcript bubble."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    # Canonical position in the meeting. The desktop renders and the live
    # stream filters on this one order — timestamps are display-only.
    sequence: int
    source: Literal["me", "them"]
    text: str
    created_at: UtcDateTime


class TranscriptRead(BaseModel):
    """The entry's transcript, utterance by utterance."""

    lines: list[TranscriptLineRead]
