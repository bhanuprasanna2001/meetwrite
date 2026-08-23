"""Endpoints for tags — the user's flat labels shared across notes."""

from fastapi import APIRouter, HTTPException, status

from meetwrite.db.session import DbSession
from meetwrite.features.entries.schemas import TagRename
from meetwrite.features.entries.services import delete_tag, rename_tag
from meetwrite.features.user.dependencies import LocalUser

router = APIRouter(prefix="/tags", tags=["tags"])


@router.patch("/{value}", status_code=status.HTTP_204_NO_CONTENT)
def update_tag(
    value: str, payload: TagRename, user: LocalUser, session: DbSession
) -> None:
    """Rename the tag everywhere. A blank name is rejected; renaming onto
    an existing tag merges the two into one."""

    assert user.id is not None
    if not payload.value.strip():
        raise HTTPException(status_code=400, detail="Tag name cannot be empty")
    if rename_tag(session, user.id, value, payload.value) is None:
        raise HTTPException(status_code=404, detail="Tag not found")


@router.delete("/{value}", status_code=status.HTTP_204_NO_CONTENT)
def remove_tag(value: str, user: LocalUser, session: DbSession) -> None:
    """Delete the tag from every note. A missing tag resolves to the same
    outcome, so the call is idempotent."""

    assert user.id is not None
    delete_tag(session, user.id, value)
