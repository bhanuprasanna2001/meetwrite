"""Transcription dictionary endpoints."""

from fastapi import APIRouter, HTTPException, status

from meetwrite.db.models import DictionaryTerm
from meetwrite.db.session import DbSession
from meetwrite.features.dictionary import schemas
from meetwrite.features.dictionary.dependencies import CurrentDictionaryTerm
from meetwrite.features.dictionary.services import (
    DictionaryFull,
    InvalidTerm,
    add_terms,
    delete_term,
    list_terms,
)
from meetwrite.features.user.dependencies import LocalUser

router = APIRouter(prefix="/dictionary", tags=["dictionary"])


@router.get("", response_model=list[schemas.DictionaryTermRead])
def read_dictionary(user: LocalUser, session: DbSession) -> list[DictionaryTerm]:
    assert user.id is not None
    return list_terms(session, user.id)


@router.post(
    "",
    response_model=list[schemas.DictionaryTermRead],
    status_code=status.HTTP_201_CREATED,
)
def add_dictionary_terms(
    payload: schemas.DictionaryTermsCreate,
    user: LocalUser,
    session: DbSession,
) -> list[DictionaryTerm]:
    assert user.id is not None
    try:
        return add_terms(session, user.id, payload.values)
    except InvalidTerm:
        raise HTTPException(
            status_code=422,
            detail="Each term must be 1–100 characters with no control "
            "characters or < >",
        ) from None
    except DictionaryFull:
        raise HTTPException(
            status_code=400, detail="Dictionary is full (200 terms)"
        ) from None


@router.delete("/{term_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_dictionary_term(term: CurrentDictionaryTerm, session: DbSession) -> None:
    delete_term(session, term)
