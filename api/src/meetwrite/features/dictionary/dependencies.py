"""Dictionary route dependencies."""

from typing import Annotated

from fastapi import Depends, HTTPException

from meetwrite.db.models import DictionaryTerm
from meetwrite.db.session import DbSession
from meetwrite.features.dictionary.services import get_term
from meetwrite.features.user.dependencies import LocalUser


def get_term_or_404(
    term_id: int, user: LocalUser, session: DbSession
) -> DictionaryTerm:
    assert user.id is not None
    term = get_term(session, user.id, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Dictionary term not found")
    return term


CurrentDictionaryTerm = Annotated[DictionaryTerm, Depends(get_term_or_404)]
