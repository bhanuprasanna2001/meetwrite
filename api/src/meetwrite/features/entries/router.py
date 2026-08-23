"""Endpoints for notes (entries)."""

import base64
import binascii
import logging
from typing import Annotated

from fastapi import (
    APIRouter,
    Body,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)

from meetwrite.core.audio import pcm_duration_seconds, pcm_to_wav, validate_pcm16
from meetwrite.core.runtime import RuntimeDep
from meetwrite.db.models import EntryImage
from meetwrite.db.session import DbSession
from meetwrite.features.entries import schemas
from meetwrite.features.entries.dependencies import CurrentEntry
from meetwrite.features.entries.images import (
    MAX_IMAGE_BYTES,
    create_image,
    delete_image,
    get_image,
    normalize_title,
    rename_image,
)
from meetwrite.features.entries.schemas import EntryImageRead
from meetwrite.features.entries.services import (
    UnknownFolderError,
    create_entry,
    delete_entry,
    get_or_create_daily_entry,
    list_entries,
    replace_tags,
    tags_for_entries,
    to_outline,
    to_read,
    update_entry,
)
from meetwrite.features.user.dependencies import LocalUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/entries", tags=["entries"])


def _unknown_folder() -> HTTPException:
    return HTTPException(status_code=404, detail="Folder not found")


def to_image_read(image: EntryImage) -> EntryImageRead:
    assert image.id is not None
    return EntryImageRead(
        id=image.id,
        entry_id=image.entry_id,
        title=image.title,
        mime_type=image.mime_type,
        created_at=image.created_at,
    )


@router.post("", response_model=schemas.EntryRead, status_code=status.HTTP_201_CREATED)
def post_entry(
    user: LocalUser,
    session: DbSession,
    payload: Annotated[schemas.EntryCreate | None, Body()] = None,
) -> schemas.EntryRead:
    assert user.id is not None
    try:
        entry = create_entry(session, user.id, payload.folder_id if payload else None)
    except UnknownFolderError:
        raise _unknown_folder() from None
    return to_read(session, entry)


@router.get("", response_model=list[schemas.EntrySummary])
def read_entries(
    user: LocalUser,
    session: DbSession,
    folder_id: int | None = None,
) -> list[schemas.EntrySummary]:
    assert user.id is not None
    return list_entries(session, user.id, folder_id)


@router.post("/daily", response_model=schemas.DailyNoteRead)
def post_daily_entry(
    payload: schemas.DailyNoteCreate,
    user: LocalUser,
    session: DbSession,
) -> schemas.DailyNoteRead:
    """Today's note: the same call always lands on the same note for one
    date — created on the first call, returned ever after."""
    assert user.id is not None
    try:
        entry, created = get_or_create_daily_entry(
            session, user.id, payload.date, payload.folder_id
        )
    except UnknownFolderError:
        raise _unknown_folder() from None
    return schemas.DailyNoteRead(entry=to_read(session, entry), created=created)


@router.get("/{entry_id}", response_model=schemas.EntryRead)
def read_entry(entry: CurrentEntry, session: DbSession) -> schemas.EntryRead:
    return to_read(session, entry)


@router.get("/{entry_id}/outline", response_model=schemas.EntryOutline)
def read_entry_outline(entry: CurrentEntry, session: DbSession) -> schemas.EntryOutline:
    """The compact sidebar outline: transcript presence and chat titles."""

    return to_outline(session, entry)


@router.patch("/{entry_id}", response_model=schemas.EntryRead)
def patch_entry(
    payload: schemas.EntryUpdate,
    entry: CurrentEntry,
    session: DbSession,
) -> schemas.EntryRead:
    try:
        return to_read(session, update_entry(session, entry, payload))
    except UnknownFolderError:
        raise _unknown_folder() from None


@router.get("/{entry_id}/tags", response_model=schemas.TagRead)
def read_entry_tags(entry: CurrentEntry, session: DbSession) -> schemas.TagRead:
    assert entry.id is not None
    tags = tags_for_entries(session, entry.user_id).get(entry.id, [])
    return schemas.TagRead(tags=tags)


@router.put("/{entry_id}/tags", response_model=schemas.TagRead)
def put_entry_tags(
    payload: schemas.TagReplace,
    entry: CurrentEntry,
    session: DbSession,
) -> schemas.TagRead:
    """Replace the note's tags with exactly this list (normalized)."""

    return schemas.TagRead(tags=replace_tags(session, entry, payload.tags))


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_entry(entry: CurrentEntry, session: DbSession, runtime: RuntimeDep) -> None:
    assert entry.id is not None
    entry_id, user_id = entry.id, entry.user_id
    try:
        runtime.audio_store.delete(user_id, entry_id)
    except Exception as error:
        logger.warning(
            "audio.delete_failed user_id=%s entry_id=%s error_type=%s",
            user_id,
            entry_id,
            type(error).__name__,
        )
        raise HTTPException(
            status_code=500,
            detail="The recording could not be deleted — try again",
        ) from error
    delete_entry(session, entry)


@router.post("/{entry_id}/audio", status_code=status.HTTP_204_NO_CONTENT)
def append_entry_audio(
    entry: CurrentEntry, payload: schemas.AudioAppend, runtime: RuntimeDep
) -> None:
    assert entry.id is not None
    try:
        pcm = base64.b64decode(payload.audio, validate=True)
        validate_pcm16(pcm)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=400, detail="audio must be base64-encoded PCM16"
        ) from None
    runtime.audio_store.append(entry.user_id, entry.id, pcm)
    logger.debug("audio.appended entry_id=%s bytes=%s", entry.id, len(pcm))


@router.post(
    "/{entry_id}/images",
    response_model=EntryImageRead,
    status_code=status.HTTP_201_CREATED,
)
def post_entry_image(
    entry: CurrentEntry,
    session: DbSession,
    file: Annotated[UploadFile, File()],
    title: Annotated[str | None, Form()] = None,
) -> EntryImageRead:
    """Store one picture on the note. Only declared image types are taken,
    and anything over MAX_IMAGE_BYTES is refused before it is read."""
    mime_type = file.content_type or ""
    if not mime_type.startswith("image/"):
        raise HTTPException(
            status_code=415, detail="Only image files can be attached to a note"
        )
    data = file.file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Images must be 20 MB or smaller",
        )
    image = create_image(
        session,
        entry,
        data=data,
        mime_type=mime_type,
        title=normalize_title(title),
    )
    return to_image_read(image)


@router.get("/{entry_id}/images/{image_id}")
def read_entry_image_file(
    entry: CurrentEntry,
    image_id: int,
    session: DbSession,
) -> Response:
    """The picture itself — served straight from the row with its own
    content type, so previews and thumbnails need no extra encoding."""
    image = get_image(session, entry, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(content=image.data, media_type=image.mime_type)


@router.patch("/{entry_id}/images/{image_id}", response_model=EntryImageRead)
def patch_entry_image(
    payload: schemas.EntryImageTitleUpdate,
    entry: CurrentEntry,
    image_id: int,
    session: DbSession,
) -> EntryImageRead:
    """Rename one picture (null clears the title back to untitled)."""
    image = get_image(session, entry, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return to_image_read(rename_image(session, image, payload.title))


@router.delete("/{entry_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_entry_image(
    entry: CurrentEntry,
    image_id: int,
    session: DbSession,
) -> None:
    """Delete one picture. The note keeps any markdown reference; the
    preview simply renders nothing for a missing image id."""
    image = get_image(session, entry, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    delete_image(session, image)


@router.get("/{entry_id}/audio", response_model=schemas.AudioRead)
def read_entry_audio(entry: CurrentEntry, runtime: RuntimeDep) -> schemas.AudioRead:
    assert entry.id is not None
    pcm = runtime.audio_store.read(entry.user_id, entry.id)
    if pcm is None:
        return schemas.AudioRead(duration_s=0.0)
    return schemas.AudioRead(duration_s=round(pcm_duration_seconds(pcm), 1))


@router.get("/{entry_id}/audio/file")
def read_entry_audio_file(entry: CurrentEntry, runtime: RuntimeDep) -> Response:
    assert entry.id is not None
    pcm = runtime.audio_store.read(entry.user_id, entry.id)
    if pcm is None:
        raise HTTPException(status_code=404, detail="No audio for this entry")
    return Response(content=pcm_to_wav(pcm), media_type="audio/wav")
