"""FastAPI dependencies for the user feature."""

from typing import Annotated

from fastapi import Depends, HTTPException

from meetwrite.db.models import User
from meetwrite.db.session import DbSession
from meetwrite.features.user.services import ensure_local_user


def get_local_user(session: DbSession) -> User:
    return ensure_local_user(session)


LocalUser = Annotated[User, Depends(get_local_user)]


def get_current_user(user: LocalUser) -> User:
    if user.name is None:
        raise HTTPException(status_code=404, detail="No user yet")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
