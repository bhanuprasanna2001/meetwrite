"""Note-enhancement endpoints."""

import logging

from fastapi import APIRouter, HTTPException
from sqlmodel import Session

from meetwrite.core.ports import AiProviderError
from meetwrite.core.runtime import RuntimeDep
from meetwrite.db.models import EnhancedVersion
from meetwrite.db.session import DbSession
from meetwrite.features.enhance import schemas
from meetwrite.features.enhance.dependencies import CurrentVersion
from meetwrite.features.enhance.services import (
    EnhanceFormatError,
    build_enhancement_input,
    create_version,
    enhance_notes,
    enhance_source,
    has_enough_source,
    list_versions,
    parse_title,
    update_version,
)
from meetwrite.features.entries.dependencies import CurrentEntry
from meetwrite.features.entries.services import get_entry
from meetwrite.features.settings.dependencies import AiEnabled
from meetwrite.features.templates.services import get_template
from meetwrite.features.user.dependencies import LocalUser

logger = logging.getLogger(__name__)

router = APIRouter(tags=["enhance"])


@router.post("/entries/{entry_id}/enhance", response_model=schemas.EnhancedVersionRead)
async def enhance_entry(
    entry: CurrentEntry,
    user: LocalUser,
    session: DbSession,
    ai: AiEnabled,
    runtime: RuntimeDep,
    payload: schemas.EnhanceRequest | None = None,
) -> EnhancedVersion:
    assert user.id is not None
    if not has_enough_source(session, entry):
        raise HTTPException(
            status_code=400,
            detail="Nothing to enhance yet — write some notes or record first",
        )
    template = None
    if payload is not None and payload.template_id:
        template = get_template(session, user.id, payload.template_id)
        if template is None:
            raise HTTPException(
                status_code=400, detail=f"Unknown template '{payload.template_id}'"
            )
    custom = (
        payload.instructions.strip()
        if payload is not None and payload.instructions
        else None
    )
    instructions, source = build_enhancement_input(
        session,
        entry,
        template,
        custom,
        runtime.config.enhance_context_characters,
    )
    entry_id = entry.id
    assert entry_id is not None
    selected_template_id = template.id if template is not None else None
    session.close()

    try:
        title, notes = await enhance_notes(
            runtime.ai,
            user.id,
            instructions=instructions,
            source=source,
        )
    except EnhanceFormatError:
        logger.warning("enhance.invalid_output entry_id=%s", entry.id)
        raise HTTPException(
            status_code=502,
            detail="Enhance produced an unreadable result — try again",
        ) from None
    except AiProviderError as error:
        logger.warning(
            "enhance.failed user_id=%s entry_id=%s status=%s",
            user.id,
            entry.id,
            error.status_code,
        )
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error

    with Session(runtime.engine) as write_session:
        current_entry = get_entry(write_session, user.id, entry_id)
        if current_entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        version = create_version(
            write_session,
            current_entry,
            title,
            notes,
            selected_template_id,
        )
    logger.info(
        "enhance.completed user_id=%s entry_id=%s version_id=%s",
        user.id,
        entry.id,
        version.id,
    )
    return version


@router.post("/entries/{entry_id}/suggest-title", response_model=schemas.TitleRead)
async def suggest_entry_title(
    entry: CurrentEntry,
    user: LocalUser,
    session: DbSession,
    ai: AiEnabled,
    runtime: RuntimeDep,
) -> schemas.TitleRead:
    """Suggest one title from the note's own content. A suggestion is never
    saved — the client shows it for confirmation and reuses the rename flow."""
    assert user.id is not None
    assert entry.id is not None
    source = enhance_source(session, entry, runtime.config.enhance_context_characters)
    session.close()

    try:
        output = await runtime.ai.suggest_title(user.id, source=source)
        title = parse_title(output)
    except EnhanceFormatError:
        logger.warning("title.invalid_output entry_id=%s", entry.id)
        raise HTTPException(
            status_code=502,
            detail="The suggestion was unreadable — try again",
        ) from None
    except AiProviderError as error:
        logger.warning(
            "title.suggest_failed user_id=%s entry_id=%s status=%s",
            user.id,
            entry.id,
            error.status_code,
        )
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error

    logger.info("title.suggested user_id=%s entry_id=%s", user.id, entry.id)
    return schemas.TitleRead(title=title)


@router.get(
    "/entries/{entry_id}/enhanced-versions",
    response_model=list[schemas.EnhancedVersionRead],
)
def read_versions(
    entry: CurrentEntry, user: LocalUser, session: DbSession
) -> list[schemas.EnhancedVersionRead]:
    assert entry.id is not None
    assert user.id is not None
    return [
        schemas.EnhancedVersionRead.model_validate(version)
        for version in list_versions(session, user.id, entry.id)
    ]


@router.patch(
    "/enhanced-versions/{version_id}", response_model=schemas.EnhancedVersionRead
)
def patch_version(
    payload: schemas.EnhancedVersionUpdate,
    version: CurrentVersion,
    session: DbSession,
) -> EnhancedVersion:
    return update_version(session, version, payload.content)
