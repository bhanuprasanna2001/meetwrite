"""Endpoints for the one-shot setup workflows."""

import logging

from fastapi import APIRouter

from meetwrite.db.session import DbSession
from meetwrite.features.user.dependencies import LocalUser
from meetwrite.features.workflows import schemas
from meetwrite.features.workflows.services import setup_leetcode

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.post("/leetcode", response_model=schemas.LeetCodeSetupRead)
def post_leetcode_setup(
    user: LocalUser, session: DbSession
) -> schemas.LeetCodeSetupRead:
    """Create the LeetCode folder and its starter note once. Re-running
    reports what exists — it never duplicates the folder or the note."""
    assert user.id is not None
    logger.info("workflow.leetcode_started user_id=%s", user.id)
    folder, folder_created, starter_created = setup_leetcode(session, user.id)
    assert folder.id is not None
    logger.info(
        "workflow.leetcode_completed user_id=%s folder_id=%s folder_created=%s starter_created=%s",
        user.id,
        folder.id,
        folder_created,
        starter_created,
    )
    return schemas.LeetCodeSetupRead(
        folder_id=folder.id,
        folder_created=folder_created,
        starter_created=starter_created,
    )
