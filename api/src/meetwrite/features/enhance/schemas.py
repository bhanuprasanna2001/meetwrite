"""Request and response models for enhance."""

from pydantic import BaseModel, ConfigDict, Field

from meetwrite.core.time import UtcDateTime


class EnhanceRequest(BaseModel):
    """The options one enhance run may carry — both optional (Auto default)."""

    template_id: str | None = Field(default=None, max_length=80)
    instructions: str | None = Field(default=None, max_length=2_000)


class EnhancedVersionRead(BaseModel):
    """One saved enhanced version, as the client sees it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    entry_id: int
    title: str | None
    content: str
    template_id: str | None
    created_at: UtcDateTime


class EnhancedVersionUpdate(BaseModel):
    """The field a version edit can change — just its content."""

    content: str = Field(max_length=1_000_000)


class TitleRead(BaseModel):
    """One suggested title. The client confirms it before anything is saved."""

    title: str
