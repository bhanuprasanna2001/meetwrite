"""Request and response models for /templates."""

from pydantic import BaseModel, ConfigDict, Field


class TemplateCreate(BaseModel):
    """The fields a new custom template needs — only the name is required."""

    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=300)
    instructions: str = Field(default="", max_length=4_000)


class TemplateUpdate(BaseModel):
    """The fields a template edit can change — all optional."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=300)
    instructions: str | None = Field(default=None, max_length=4_000)


class TemplateRead(BaseModel):
    """One template, as the client sees it."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str
    instructions: str
    is_builtin: bool
