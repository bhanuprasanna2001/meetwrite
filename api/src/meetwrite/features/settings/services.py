"""User-preference persistence."""

import logging

from sqlmodel import Session

from meetwrite.db.models import Preferences
from meetwrite.features.folders.services import get_folder
from meetwrite.features.settings.schemas import SettingsUpdate

logger = logging.getLogger(__name__)


class DailyFolderUnknownError(Exception):
    """The saved daily-note folder no longer exists (or was never ours)."""


def ensure_preferences(session: Session, user_id: int) -> Preferences:
    preferences = session.get(Preferences, user_id)
    if preferences is None:
        preferences = Preferences(user_id=user_id)
        session.add(preferences)
        session.commit()
        session.refresh(preferences)
    return preferences


def save_settings(
    session: Session, preferences: Preferences, payload: SettingsUpdate
) -> Preferences:
    # The folder reference is loose (no FK), but saving a pointer to a
    # folder the user doesn't own would silently break the daily note later;
    # refuse it now with one clear error.
    if (
        payload.daily_note_folder_id is not None
        and get_folder(session, preferences.user_id, payload.daily_note_folder_id)
        is None
    ):
        raise DailyFolderUnknownError()
    previous_ai_enabled = preferences.ai_enabled
    preferences.sqlmodel_update(payload)
    session.add(preferences)
    session.commit()
    session.refresh(preferences)
    if preferences.ai_enabled != previous_ai_enabled:
        logger.info(
            "preferences.ai_mode_changed user_id=%s ai_enabled=%s",
            preferences.user_id,
            preferences.ai_enabled,
        )
    logger.info("preferences.saved user_id=%s", preferences.user_id)
    return preferences
