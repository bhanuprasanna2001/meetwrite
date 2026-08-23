"""Dependencies that enforce the user's AI-mode preference."""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException

from meetwrite.db.session import DbSession
from meetwrite.features.settings.services import ensure_preferences
from meetwrite.features.user.dependencies import LocalUser

logger = logging.getLogger(__name__)


def require_ai_enabled(user: LocalUser, session: DbSession) -> None:
    """Reject AI-only endpoints while the user runs in notes-only mode.

    The desktop hides every AI surface when `ai_enabled` is off; this gate is
    the server-side backstop so a stale or modified client can never trigger a
    provider call.
    """
    assert user.id is not None
    if not ensure_preferences(session, user.id).ai_enabled:
        logger.warning("ai.gate_rejected user_id=%s", user.id)
        raise HTTPException(status_code=403, detail="AI features are turned off")


AiEnabled = Annotated[None, Depends(require_ai_enabled)]
