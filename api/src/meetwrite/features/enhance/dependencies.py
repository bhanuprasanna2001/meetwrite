"""Enhanced-version route dependencies."""

from typing import Annotated

from fastapi import Depends, HTTPException

from meetwrite.db.models import EnhancedVersion
from meetwrite.db.session import DbSession
from meetwrite.features.enhance.services import get_version
from meetwrite.features.user.dependencies import LocalUser


def get_version_or_404(
    version_id: int, user: LocalUser, session: DbSession
) -> EnhancedVersion:
    assert user.id is not None
    version = get_version(session, user.id, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Enhanced version not found")
    return version


CurrentVersion = Annotated[EnhancedVersion, Depends(get_version_or_404)]
