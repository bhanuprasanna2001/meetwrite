"""Entry persistence and meeting-context projections."""

import logging

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select, update

from meetwrite.core.time import utc_now
from meetwrite.db.models import Chat, Entry, EntryImage, EntryTag, Tag, TranscriptLine
from meetwrite.features.entries.schemas import (
    EntryOutline,
    EntryRead,
    EntrySummary,
    EntryUpdate,
    OutlineChat,
    OutlineImage,
)
from meetwrite.features.entries.templates import (
    daily_note_template,
    is_leetcode_folder,
    leetcode_template,
)
from meetwrite.features.folders.services import get_folder, get_or_create_inbox

logger = logging.getLogger(__name__)

PREVIEW_LENGTH = 140


class UnknownFolderError(Exception):
    """The move/creation target is not a folder of the current user."""


def create_entry(session: Session, user_id: int, folder_id: int | None = None) -> Entry:
    if folder_id is None:
        home = get_or_create_inbox(session, user_id)
    else:
        target = get_folder(session, user_id, folder_id)
        if target is None:
            raise UnknownFolderError()
        home = target
    assert home.id is not None
    # One rule: a new note in the LeetCode folder starts from the problem
    # template; every other note starts blank.
    note_md = leetcode_template() if is_leetcode_folder(home.name) else None
    entry = Entry(user_id=user_id, folder_id=home.id, note_md=note_md)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    logger.info("entry.created user_id=%s entry_id=%s", user_id, entry.id)
    return entry


def list_entries(
    session: Session, user_id: int, folder_id: int | None = None
) -> list[EntrySummary]:
    query = select(Entry).where(Entry.user_id == user_id)
    if folder_id is not None:
        query = query.where(Entry.folder_id == folder_id)
    entries = session.exec(
        query.order_by(col(Entry.updated_at).desc(), col(Entry.id).desc())
    ).all()
    tags_by_entry = tags_for_entries(session, user_id)
    images_by_entry = images_for_entries(session, user_id)
    summaries: list[EntrySummary] = []
    for entry in entries:
        assert entry.id is not None
        summaries.append(
            to_summary(
                entry,
                tags_by_entry.get(entry.id, []),
                images_by_entry.get(entry.id, []),
            )
        )
    return summaries


def get_entry(session: Session, user_id: int, entry_id: int) -> Entry | None:
    return session.exec(
        select(Entry).where(Entry.id == entry_id, Entry.user_id == user_id)
    ).first()


def update_entry(session: Session, entry: Entry, payload: EntryUpdate) -> Entry:
    changes = payload.model_dump(exclude_unset=True)
    target_folder_id = changes.pop("folder_id", None)
    if target_folder_id is not None:
        # A move must land in a folder the same user owns — never someone
        # else's folder, never a deleted one.
        folder = get_folder(session, entry.user_id, target_folder_id)
        if folder is None:
            raise UnknownFolderError()
        assert folder.id is not None
        entry.folder_id = folder.id
    entry.sqlmodel_update(changes)
    entry.updated_at = utc_now()
    session.add(entry)
    session.commit()
    session.refresh(entry)
    logger.debug("entry.updated user_id=%s entry_id=%s", entry.user_id, entry.id)
    return entry


def delete_entry(session: Session, entry: Entry) -> None:
    assert entry.id is not None
    entry_id, user_id = entry.id, entry.user_id
    session.delete(entry)
    prune_orphan_tags(session, user_id)
    session.commit()
    logger.info("entry.deleted user_id=%s entry_id=%s", user_id, entry_id)


def to_summary(
    entry: Entry,
    tags: list[str] | None = None,
    images: list[OutlineImage] | None = None,
) -> EntrySummary:
    assert entry.id is not None
    # The preview is the note's own text; the title is only the fallback for
    # notes with nothing written. (Title-first made EVERY titled note's
    # preview equal its title, so lists showed "Empty note" for them all.)
    preview = " ".join((entry.note_md or entry.title or "").split())[:PREVIEW_LENGTH]
    return EntrySummary(
        id=entry.id,
        folder_id=entry.folder_id,
        title=entry.title,
        preview=preview,
        tags=tags or [],
        images=images or [],
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def list_transcript_lines(session: Session, entry_id: int) -> list[TranscriptLine]:
    return list(
        session.exec(
            select(TranscriptLine)
            .where(TranscriptLine.entry_id == entry_id)
            .order_by(col(TranscriptLine.sequence), col(TranscriptLine.id))
        ).all()
    )


def transcript_text(session: Session, entry_id: int) -> str | None:
    lines = list_transcript_lines(session, entry_id)
    return "\n".join(f"{line.source}: {line.text}" for line in lines) or None


def to_read(session: Session, entry: Entry) -> EntryRead:
    assert entry.id is not None
    return EntryRead(
        id=entry.id,
        folder_id=entry.folder_id,
        title=entry.title,
        note_md=entry.note_md,
        transcript=transcript_text(session, entry.id),
        images=images_for_entries(session, entry.user_id).get(entry.id, []),
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def to_outline(session: Session, entry: Entry) -> EntryOutline:
    """The sidebar's compact view of a note: does it have a transcript,
    which chats and images does it hold. Messages and bytes are only
    fetched when a chat or image actually opens."""
    assert entry.id is not None
    has_transcript = (
        session.exec(
            select(TranscriptLine.id)
            .where(TranscriptLine.entry_id == entry.id)
            .limit(1)
        ).first()
        is not None
    )
    chats = session.exec(
        select(Chat)
        .where(Chat.entry_id == entry.id)
        .order_by(col(Chat.created_at), col(Chat.id))
    ).all()
    outline_chats: list[OutlineChat] = []
    for chat in chats:
        assert chat.id is not None
        outline_chats.append(OutlineChat(id=chat.id, title=chat.title))
    return EntryOutline(
        has_transcript=has_transcript,
        chats=outline_chats,
        images=images_for_entries(session, entry.user_id).get(entry.id, []),
    )


def images_for_entries(session: Session, user_id: int) -> dict[int, list[OutlineImage]]:
    """Every entry's images in one query, oldest first — the same pattern
    as tags, so listing notes never costs one query per note."""

    rows = session.exec(
        select(EntryImage.entry_id, EntryImage.id, EntryImage.title)
        .where(EntryImage.user_id == user_id)
        .order_by(col(EntryImage.created_at), col(EntryImage.id))
    ).all()
    result: dict[int, list[OutlineImage]] = {}
    for entry_id, image_id, title in rows:
        # Rows come from committed rows, so the id is always set.
        assert image_id is not None
        result.setdefault(entry_id, []).append(OutlineImage(id=image_id, title=title))
    return result


def get_or_create_daily_entry(
    session: Session, user_id: int, date: str, folder_id: int | None
) -> tuple[Entry, bool]:
    """Today's note, creating it on the first call of the day. The partial
    unique index on (user_id, daily_date) makes two racing creates converge
    on one row: the loser's insert fails and re-reads the winner. The title
    is the date itself — stable, sortable, and never a guess about locale."""
    existing = session.exec(
        select(Entry).where(Entry.user_id == user_id, Entry.daily_date == date)
    ).first()
    if existing is not None:
        return existing, False

    if folder_id is None:
        home = get_or_create_inbox(session, user_id)
    else:
        target = get_folder(session, user_id, folder_id)
        if target is None:
            raise UnknownFolderError()
        home = target
    assert home.id is not None
    entry = Entry(
        user_id=user_id,
        folder_id=home.id,
        title=date,
        daily_date=date,
        note_md=daily_note_template(date),
    )
    session.add(entry)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        winner = session.exec(
            select(Entry).where(Entry.user_id == user_id, Entry.daily_date == date)
        ).first()
        if winner is not None:
            return winner, False
        raise
    session.refresh(entry)
    logger.info(
        "entry.daily_created user_id=%s entry_id=%s date=%s", user_id, entry.id, date
    )
    return entry, True


def tags_for_entries(session: Session, user_id: int) -> dict[int, list[str]]:
    """Every entry's tags in one query, sorted by value for stable display."""

    rows = session.exec(
        select(EntryTag.entry_id, Tag.value)
        .join(Tag, col(EntryTag.tag_id) == col(Tag.id))
        .where(EntryTag.user_id == user_id)
        .order_by(col(Tag.value), col(Tag.id))
    ).all()
    result: dict[int, list[str]] = {}
    for entry_id, value in rows:
        result.setdefault(entry_id, []).append(value)
    return result


def normalize_tag(value: str) -> str:
    return " ".join(value.split())


def replace_tags(session: Session, entry: Entry, values: list[str]) -> list[str]:
    """Replace the entry's tags in one commit. Values are trimmed, blanks
    dropped, and case-insensitively deduplicated (first casing wins); there
    is no count cap — LeetCode problems can carry as many tags as needed.
    Tags that end up with no entries are removed.
    """
    assert entry.id is not None
    entry_id: int = entry.id
    kept: list[str] = []
    seen: set[str] = set()
    for raw in values:
        cleaned = normalize_tag(raw)
        key = cleaned.lower()
        if not key or key in seen:
            continue
        seen.add(key)
        kept.append(cleaned)

    existing = {
        tag.normalized_value.lower(): tag
        for tag in session.exec(select(Tag).where(Tag.user_id == entry.user_id)).all()
    }
    session.exec(delete(EntryTag).where(col(EntryTag.entry_id) == entry_id))
    for cleaned in kept:
        tag = existing.get(cleaned.lower())
        if tag is None:
            tag = Tag(
                user_id=entry.user_id, value=cleaned, normalized_value=cleaned.lower()
            )
            session.add(tag)
            session.flush()
            existing[cleaned.lower()] = tag
        assert tag.id is not None
        session.add(EntryTag(entry_id=entry_id, tag_id=tag.id, user_id=entry.user_id))

    prune_orphan_tags(session, entry.user_id)

    entry.updated_at = utc_now()
    session.add(entry)
    session.commit()
    logger.info(
        "entry.tags_replaced user_id=%s entry_id=%s tag_count=%s",
        entry.user_id,
        entry_id,
        len(kept),
    )
    return kept


def prune_orphan_tags(session: Session, user_id: int) -> None:
    """Remove tags no entry uses anymore — the tag list never accumulates
    dead rows, whatever path (replace or entry delete) removed the join."""

    for tag in session.exec(
        select(Tag).where(
            Tag.user_id == user_id,
            col(Tag.id).not_in(
                select(EntryTag.tag_id).where(EntryTag.user_id == user_id)
            ),
        )
    ).all():
        session.delete(tag)


def delete_tag(session: Session, user_id: int, value: str) -> None:
    """Delete the tag everywhere for the user in one commit: every note
    loses it and the tag row itself goes. A missing tag is a no-op, so
    retries and stale names resolve the same way. Note timestamps stay
    untouched — unlinking a tag is not a note edit."""

    key = normalize_tag(value).lower()
    tag = session.exec(
        select(Tag).where(col(Tag.user_id) == user_id, col(Tag.normalized_value) == key)
    ).first()
    if tag is None:
        return
    assert tag.id is not None
    session.exec(
        delete(EntryTag).where(
            col(EntryTag.user_id) == user_id, col(EntryTag.tag_id) == tag.id
        )
    )
    session.delete(tag)
    session.commit()
    logger.info("tag.deleted user_id=%s tag_id=%s", user_id, tag.id)


def rename_tag(
    session: Session, user_id: int, value: str, new_value: str
) -> Tag | None:
    """Rename the tag everywhere in one commit; None when it doesn't exist.
    Renaming onto an existing tag merges the two — entries that carried both
    keep one join, the losing row goes — and note timestamps stay untouched.
    """

    new_cleaned = normalize_tag(new_value)
    new_key = new_cleaned.lower()
    tag = session.exec(
        select(Tag).where(
            col(Tag.user_id) == user_id,
            col(Tag.normalized_value) == normalize_tag(value).lower(),
        )
    ).first()
    if tag is None:
        return None
    assert tag.id is not None
    target = session.exec(
        select(Tag).where(
            col(Tag.user_id) == user_id, col(Tag.normalized_value) == new_key
        )
    ).first()
    if target is None:
        tag.value = new_cleaned
        tag.normalized_value = new_key
        session.add(tag)
    elif target.id != tag.id:
        assert target.id is not None
        # Entries carrying both tags would collide on the join's primary
        # key — drop the doomed one first, then repoint the rest.
        session.exec(
            delete(EntryTag).where(
                col(EntryTag.user_id) == user_id,
                col(EntryTag.tag_id) == target.id,
                col(EntryTag.entry_id).in_(
                    select(EntryTag.entry_id).where(
                        col(EntryTag.user_id) == user_id,
                        col(EntryTag.tag_id) == tag.id,
                    )
                ),
            )
        )
        session.exec(
            update(EntryTag)
            .where(
                col(EntryTag.user_id) == user_id,
                col(EntryTag.tag_id) == tag.id,
            )
            .values(tag_id=target.id)
        )
        session.delete(tag)
        tag = target
    session.commit()
    logger.info("tag.renamed user_id=%s tag_id=%s", user_id, tag.id)
    return tag


def meeting_source(session: Session, entry: Entry, limit: int) -> str:
    assert entry.id is not None
    text = (
        f"# Meeting notes\n{entry.note_md or '(empty)'}\n\n"
        f"# Transcript\n{transcript_text(session, entry.id) or '(empty)'}"
    )
    if len(text) <= limit:
        return text
    marker = "[earlier content omitted]\n"
    tail_length = max(0, limit - len(marker))
    return marker[:limit] if tail_length == 0 else marker + text[-tail_length:]
