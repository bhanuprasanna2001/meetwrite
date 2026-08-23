"""Canonical transcript-line persistence."""

import logging
from typing import Any

from sqlalchemy import Engine
from sqlmodel import Session, col, func, select

from meetwrite.core.time import utc_isoformat, utc_now
from meetwrite.db.models import DictionaryTerm, Entry, TranscriptLine
from meetwrite.features.dictionary.services import InvalidTerm, normalize_term

logger = logging.getLogger(__name__)

MAX_HINTS_PER_RECORDING = 50


def list_lines(session: Session, user_id: int, entry_id: int) -> list[TranscriptLine]:
    return list(
        session.exec(
            select(TranscriptLine)
            .where(
                TranscriptLine.user_id == user_id,
                TranscriptLine.entry_id == entry_id,
            )
            .order_by(col(TranscriptLine.sequence), col(TranscriptLine.id))
        ).all()
    )


def next_sequence(engine: Engine, entry_id: int) -> int:
    with Session(engine) as session:
        last = session.exec(
            select(func.max(TranscriptLine.sequence)).where(
                TranscriptLine.entry_id == entry_id
            )
        ).one()
    return (last or 0) + 1


def commit_line(
    engine: Engine,
    *,
    user_id: int,
    entry_id: int,
    sequence: int,
    source: str,
    text: str,
) -> tuple[TranscriptLine, bool]:
    text = text.strip()
    with Session(engine) as session:
        existing = session.exec(
            select(TranscriptLine).where(
                TranscriptLine.user_id == user_id,
                TranscriptLine.entry_id == entry_id,
                TranscriptLine.sequence == sequence,
            )
        ).first()
        if existing is not None:
            return existing, False

        entry = session.exec(
            select(Entry).where(Entry.id == entry_id, Entry.user_id == user_id)
        ).first()
        if entry is None:
            raise LookupError("entry no longer exists")
        line = TranscriptLine(
            user_id=user_id,
            entry_id=entry_id,
            sequence=sequence,
            source=source,
            text=text,
        )
        session.add(line)
        entry.updated_at = utc_now()
        session.add(entry)
        session.commit()
        session.refresh(line)
    logger.debug(
        "transcript.saved entry_id=%s line_id=%s sequence=%s",
        entry_id,
        line.id,
        sequence,
    )
    return line, True


def keyword_hints(session: Session, user_id: int, entry: Entry) -> list[str]:
    """The immutable hint snapshot for one recording.

    Dictionary words in saved order, then the note title; deduplicated
    case-insensitively and capped so both audio sources always receive the
    identical list. Built once at recording start and never changed — a
    recording must not improve or degrade halfway through.
    """
    terms = session.exec(
        select(DictionaryTerm)
        .where(DictionaryTerm.user_id == user_id)
        .order_by(col(DictionaryTerm.created_at), col(DictionaryTerm.id))
    ).all()
    candidates = [term.value for term in terms]
    if entry.title and entry.title.strip():
        candidates.append(entry.title)

    hints: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        try:
            display, key = normalize_term(candidate)
        except InvalidTerm:
            continue
        if key in seen:
            continue
        seen.add(key)
        hints.append(display)
        if len(hints) >= MAX_HINTS_PER_RECORDING:
            break
    return hints


def line_payload(line: TranscriptLine) -> dict[str, Any]:
    assert line.id is not None
    return {
        "id": line.id,
        "sequence": line.sequence,
        "source": line.source,
        "text": line.text,
        "created_at": utc_isoformat(line.created_at),
    }
