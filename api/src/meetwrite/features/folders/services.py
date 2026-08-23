"""Folder persistence and the one-Inbox invariant."""

import logging

from sqlmodel import Session, col, func, select

from meetwrite.db.models import Entry, Folder, Preferences
from meetwrite.features.folders.schemas import FolderRead

logger = logging.getLogger(__name__)

INBOX_NAME = "Inbox"


class FolderConflictError(Exception):
    """Another folder of the same user already has this name (any casing)."""

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


class FolderProtectedError(Exception):
    """The Inbox cannot be renamed or deleted — notes always need one home."""


def get_folder(session: Session, user_id: int, folder_id: int) -> Folder | None:
    return session.exec(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == user_id)
    ).first()


def get_or_create_inbox(session: Session, user_id: int) -> Folder:
    """The one protected folder every user has. Created lazily so any path —
    migration backfill, onboarding, a direct user insert in tests — converges
    on exactly one Inbox."""
    inbox = session.exec(
        select(Folder).where(Folder.user_id == user_id, Folder.is_inbox)
    ).first()
    if inbox is None:
        inbox = Folder(user_id=user_id, name=INBOX_NAME, is_inbox=True)
        session.add(inbox)
        session.commit()
        session.refresh(inbox)
        logger.info("folder.inbox_created user_id=%s folder_id=%s", user_id, inbox.id)
    return inbox


def to_read(folder: Folder) -> FolderRead:
    assert folder.id is not None
    return FolderRead(id=folder.id, name=folder.name, is_inbox=folder.is_inbox)


def list_folders(session: Session, user_id: int) -> list[FolderRead]:
    get_or_create_inbox(session, user_id)
    folders = session.exec(
        select(Folder)
        .where(Folder.user_id == user_id)
        .order_by(col(Folder.is_inbox).desc(), func.lower(Folder.name), col(Folder.id))
    ).all()
    return [to_read(folder) for folder in folders]


def _name_taken(
    session: Session, user_id: int, name: str, exclude_id: int | None
) -> bool:
    query = select(Folder).where(
        Folder.user_id == user_id, func.lower(Folder.name) == name.lower()
    )
    if exclude_id is not None:
        query = query.where(Folder.id != exclude_id)
    return session.exec(query).first() is not None


def create_folder(session: Session, user_id: int, name: str) -> Folder:
    if _name_taken(session, user_id, name, exclude_id=None):
        raise FolderConflictError(name)
    folder = Folder(user_id=user_id, name=name)
    session.add(folder)
    session.commit()
    session.refresh(folder)
    assert folder.id is not None
    logger.info("folder.created user_id=%s folder_id=%s", user_id, folder.id)
    return folder


def rename_folder(session: Session, folder: Folder, name: str) -> Folder:
    if folder.is_inbox:
        raise FolderProtectedError()
    assert folder.id is not None
    if _name_taken(session, folder.user_id, name, exclude_id=folder.id):
        raise FolderConflictError(name)
    folder.name = name
    session.add(folder)
    session.commit()
    session.refresh(folder)
    logger.info("folder.renamed user_id=%s folder_id=%s", folder.user_id, folder.id)
    return folder


def delete_folder(session: Session, folder: Folder) -> None:
    """Move the folder's notes to Inbox, then delete the folder — one
    transaction, so a note is never homeless at any point in between. A
    daily-note setting pointing here falls back to Inbox (null) instead of
    keeping a dead reference."""
    if folder.is_inbox:
        raise FolderProtectedError()
    assert folder.id is not None
    inbox = get_or_create_inbox(session, folder.user_id)
    assert inbox.id is not None
    moved = session.exec(select(Entry).where(Entry.folder_id == folder.id)).all()
    for entry in moved:
        entry.folder_id = inbox.id
        session.add(entry)
    preferences = session.get(Preferences, folder.user_id)
    if preferences is not None and preferences.daily_note_folder_id == folder.id:
        preferences.daily_note_folder_id = None
        session.add(preferences)
    session.delete(folder)
    session.commit()
    logger.info(
        "folder.deleted user_id=%s folder_id=%s entries_moved=%s",
        folder.user_id,
        folder.id,
        len(moved),
    )
