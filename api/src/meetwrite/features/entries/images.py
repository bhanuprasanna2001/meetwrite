"""Image persistence for one note — bytes in the row, metadata beside them."""

import logging

from sqlmodel import Session, select

from meetwrite.db.models import Entry, EntryImage

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 20 * 1024 * 1024


def normalize_title(value: str | None) -> str | None:
    """One title rule everywhere: collapse whitespace, blank means none."""
    if value is None:
        return None
    return " ".join(value.split()) or None


def create_image(
    session: Session,
    entry: Entry,
    *,
    data: bytes,
    mime_type: str,
    title: str | None,
) -> EntryImage:
    """Store one picture on the note. The caller already validated type and
    size; this is a single-row insert, committed with the entry untouched
    (adding a picture is not a note edit)."""
    assert entry.id is not None
    image = EntryImage(
        user_id=entry.user_id,
        entry_id=entry.id,
        title=normalize_title(title),
        mime_type=mime_type,
        data=data,
    )
    session.add(image)
    session.commit()
    session.refresh(image)
    logger.info(
        "image.created user_id=%s entry_id=%s image_id=%s mime=%s bytes=%s",
        entry.user_id,
        entry.id,
        image.id,
        mime_type,
        len(data),
    )
    return image


def get_image(session: Session, entry: Entry, image_id: int) -> EntryImage | None:
    assert entry.id is not None
    return session.exec(
        select(EntryImage).where(
            EntryImage.id == image_id,
            EntryImage.user_id == entry.user_id,
            EntryImage.entry_id == entry.id,
        )
    ).first()


def rename_image(session: Session, image: EntryImage, title: str | None) -> EntryImage:
    image.title = normalize_title(title)
    session.add(image)
    session.commit()
    session.refresh(image)
    logger.info("image.renamed image_id=%s", image.id)
    return image


def delete_image(session: Session, image: EntryImage) -> None:
    image_id = image.id
    session.delete(image)
    session.commit()
    logger.info("image.deleted image_id=%s", image_id)
