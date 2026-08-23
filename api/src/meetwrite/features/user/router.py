"""Endpoints for the single user's name."""

from fastapi import APIRouter

from meetwrite.db.models import User
from meetwrite.db.session import DbSession
from meetwrite.features.user import schemas
from meetwrite.features.user.dependencies import CurrentUser, LocalUser
from meetwrite.features.user.services import save_name

router = APIRouter(prefix="/me", tags=["user"])


@router.get("", response_model=schemas.UserRead)
def read_me(user: CurrentUser) -> User:
    """The current user."""

    return user


@router.put("", response_model=schemas.UserRead)
def update_me(payload: schemas.UserUpdate, user: LocalUser, session: DbSession) -> User:
    return save_name(session, user, payload.name)
