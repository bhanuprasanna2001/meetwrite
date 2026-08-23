"""Request and response models for /me."""

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field


def _non_blank(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


Name = Annotated[str, Field(max_length=100), AfterValidator(_non_blank)]


class UserUpdate(BaseModel):
    """The new name to save."""

    name: Name


class UserRead(BaseModel):
    """The current user."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
