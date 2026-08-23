"""FastAPI dependencies for the folders feature."""

from typing import Annotated

from fastapi import Depends, HTTPException

from meetwrite.db.models import Folder
from meetwrite.db.session import DbSession
from meetwrite.features.folders.services import get_folder
from meetwrite.features.user.dependencies import LocalUser


def get_folder_or_404(folder_id: int, user: LocalUser, session: DbSession) -> Folder:
    assert user.id is not None
    folder = get_folder(session, user.id, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


CurrentFolder = Annotated[Folder, Depends(get_folder_or_404)]
