"""Endpoints for folders — the exclusive, single-level homes of notes."""

from fastapi import APIRouter, HTTPException, status

from meetwrite.db.session import DbSession
from meetwrite.features.folders import schemas
from meetwrite.features.folders.dependencies import CurrentFolder
from meetwrite.features.folders.services import (
    FolderConflictError,
    FolderProtectedError,
    create_folder,
    delete_folder,
    list_folders,
    rename_folder,
    to_read,
)
from meetwrite.features.user.dependencies import LocalUser

router = APIRouter(prefix="/folders", tags=["folders"])


@router.get("", response_model=list[schemas.FolderRead])
def read_folders(user: LocalUser, session: DbSession) -> list[schemas.FolderRead]:
    assert user.id is not None
    return list_folders(session, user.id)


@router.post("", response_model=schemas.FolderRead, status_code=status.HTTP_201_CREATED)
def post_folder(
    payload: schemas.FolderCreate, user: LocalUser, session: DbSession
) -> schemas.FolderRead:
    assert user.id is not None
    try:
        return to_read(create_folder(session, user.id, payload.name))
    except FolderConflictError as error:
        raise HTTPException(
            status_code=409, detail=f"A folder named “{error.name}” already exists"
        ) from None


@router.patch("/{folder_id}", response_model=schemas.FolderRead)
def patch_folder(
    payload: schemas.FolderUpdate,
    folder: CurrentFolder,
    session: DbSession,
) -> schemas.FolderRead:
    try:
        return to_read(rename_folder(session, folder, payload.name))
    except FolderConflictError as error:
        raise HTTPException(
            status_code=409, detail=f"A folder named “{error.name}” already exists"
        ) from None
    except FolderProtectedError:
        raise HTTPException(
            status_code=409, detail="The Inbox cannot be renamed"
        ) from None


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_folder(folder: CurrentFolder, session: DbSession) -> None:
    try:
        delete_folder(session, folder)
    except FolderProtectedError:
        raise HTTPException(
            status_code=409,
            detail="The Inbox cannot be deleted — notes always need one home",
        ) from None
