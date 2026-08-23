"""Endpoints for the app preferences."""

from fastapi import APIRouter, HTTPException

from meetwrite.db.models import Preferences
from meetwrite.db.session import DbSession
from meetwrite.features.settings import schemas
from meetwrite.features.settings.services import (
    DailyFolderUnknownError,
    ensure_preferences,
    save_settings,
)
from meetwrite.features.user.dependencies import LocalUser

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=schemas.SettingsRead)
def read_settings(user: LocalUser, session: DbSession) -> Preferences:
    assert user.id is not None
    return ensure_preferences(session, user.id)


@router.put("", response_model=schemas.SettingsRead)
def update_settings(
    payload: schemas.SettingsUpdate, user: LocalUser, session: DbSession
) -> Preferences:
    assert user.id is not None
    try:
        return save_settings(session, ensure_preferences(session, user.id), payload)
    except DailyFolderUnknownError:
        raise HTTPException(
            status_code=422, detail="Daily note folder not found"
        ) from None
