"""Shared UTC time helpers and response serialization."""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import PlainSerializer


def utc_now() -> datetime:
    """The current UTC time — the default for created_at / updated_at."""

    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    """Interpret SQLite's naive values as UTC and normalize aware values."""

    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def utc_isoformat(value: datetime) -> str:
    return as_utc(value).isoformat().replace("+00:00", "Z")


UtcDateTime = Annotated[
    datetime,
    PlainSerializer(as_utc, return_type=datetime, when_used="json"),
]
