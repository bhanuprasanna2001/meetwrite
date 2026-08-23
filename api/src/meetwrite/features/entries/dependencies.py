"""FastAPI dependencies for the entries feature."""

from typing import Annotated

from fastapi import Depends, HTTPException

from meetwrite.db.models import Entry
from meetwrite.db.session import DbSession
from meetwrite.features.entries.services import get_entry
from meetwrite.features.user.dependencies import LocalUser


def get_entry_or_404(entry_id: int, user: LocalUser, session: DbSession) -> Entry:
    assert user.id is not None
    entry = get_entry(session, user.id, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


CurrentEntry = Annotated[Entry, Depends(get_entry_or_404)]
