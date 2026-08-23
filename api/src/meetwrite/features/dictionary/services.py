"""User-scoped transcription dictionary."""

import logging
import unicodedata

from sqlmodel import Session, col, select

from meetwrite.db.models import DictionaryTerm

logger = logging.getLogger(__name__)

TERM_MAX_LENGTH = 100
DICTIONARY_MAX_TERMS = 200
# The Realtime API rejects the whole session update when a keyword contains
# "<", ">", or control characters, so the dictionary must never store them.
FORBIDDEN_TERM_CHARACTERS = ("<", ">")


class InvalidTerm(Exception):
    pass


class DictionaryFull(Exception):
    pass


def normalize_term(value: str) -> tuple[str, str]:
    """Return (display, normalized) for one term or raise InvalidTerm.

    Whitespace is collapsed so one line in the UI is exactly one stored
    term; the normalized form is what uniqueness checks and hint
    deduplication use.
    """
    if any(character in FORBIDDEN_TERM_CHARACTERS for character in value):
        raise InvalidTerm
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise InvalidTerm
    display = " ".join(value.split())
    if not display or len(display) > TERM_MAX_LENGTH:
        raise InvalidTerm
    normalized = unicodedata.normalize("NFKC", display).casefold()
    return display, normalized


def get_term(session: Session, user_id: int, term_id: int) -> DictionaryTerm | None:
    return session.exec(
        select(DictionaryTerm).where(
            DictionaryTerm.id == term_id,
            DictionaryTerm.user_id == user_id,
        )
    ).first()


def list_terms(session: Session, user_id: int) -> list[DictionaryTerm]:
    # created_at then id keeps the order the user added the words — the
    # same order a recording later sends as hints.
    return list(
        session.exec(
            select(DictionaryTerm)
            .where(DictionaryTerm.user_id == user_id)
            .order_by(col(DictionaryTerm.created_at), col(DictionaryTerm.id))
        ).all()
    )


def add_terms(
    session: Session, user_id: int, values: list[str]
) -> list[DictionaryTerm]:
    """Add every new value in one transaction and return the full list.

    Values are all validated first, then duplicates are skipped, so an
    invalid term never leaves half a batch behind.
    """
    normalized = [normalize_term(value) for value in values]
    current = list_terms(session, user_id)
    seen = {term.normalized_value for term in current}
    added: list[DictionaryTerm] = []
    for display, key in normalized:
        if key in seen:
            continue
        if len(current) + len(added) >= DICTIONARY_MAX_TERMS:
            raise DictionaryFull
        seen.add(key)
        added.append(
            DictionaryTerm(user_id=user_id, value=display, normalized_value=key)
        )
    if added:
        for term in added:
            session.add(term)
        session.commit()
        for term in added:
            session.refresh(term)
        logger.info(
            "dictionary.added user_id=%s added=%s total=%s",
            user_id,
            len(added),
            len(current) + len(added),
        )
    return list_terms(session, user_id)


def delete_term(session: Session, term: DictionaryTerm) -> None:
    assert term.id is not None
    session.delete(term)
    session.commit()
    logger.info("dictionary.deleted user_id=%s term_id=%s", term.user_id, term.id)
