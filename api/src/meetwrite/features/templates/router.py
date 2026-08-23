"""Meeting-template endpoints."""

from fastapi import APIRouter, HTTPException, status

from meetwrite.db.models import Template
from meetwrite.db.session import DbSession
from meetwrite.features.templates import schemas
from meetwrite.features.templates.dependencies import CurrentTemplate
from meetwrite.features.templates.services import (
    InvalidTemplateName,
    MissingCatalogTemplate,
    TemplateNameConflict,
    create_template,
    delete_template,
    list_templates,
    reset_template,
    update_template,
)
from meetwrite.features.user.dependencies import LocalUser

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[schemas.TemplateRead])
def read_templates(user: LocalUser, session: DbSession) -> list[Template]:
    assert user.id is not None
    return list_templates(session, user.id)


@router.post(
    "", response_model=schemas.TemplateRead, status_code=status.HTTP_201_CREATED
)
def post_template(
    payload: schemas.TemplateCreate, user: LocalUser, session: DbSession
) -> Template:
    assert user.id is not None
    try:
        return create_template(session, user.id, payload)
    except InvalidTemplateName:
        raise HTTPException(
            status_code=422, detail="Template name cannot be empty"
        ) from None
    except TemplateNameConflict:
        raise HTTPException(
            status_code=400, detail="A template with this name already exists"
        ) from None


@router.patch("/{template_id}", response_model=schemas.TemplateRead)
def patch_template(
    payload: schemas.TemplateUpdate,
    template: CurrentTemplate,
    session: DbSession,
) -> Template:
    try:
        return update_template(session, template, payload)
    except InvalidTemplateName:
        raise HTTPException(
            status_code=422, detail="Template name cannot be empty"
        ) from None
    except TemplateNameConflict:
        raise HTTPException(
            status_code=400, detail="A template with this name already exists"
        ) from None


@router.post("/{template_id}/reset", response_model=schemas.TemplateRead)
def reset_builtin(template: CurrentTemplate, session: DbSession) -> Template:
    if not template.is_builtin:
        raise HTTPException(
            status_code=400, detail="Only built-in templates can be reset"
        )
    try:
        return reset_template(session, template)
    except MissingCatalogTemplate:
        raise HTTPException(
            status_code=400, detail="Only built-in templates can be reset"
        ) from None
    except TemplateNameConflict:
        raise HTTPException(
            status_code=400, detail="A template with this name already exists"
        ) from None


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_template(template: CurrentTemplate, session: DbSession) -> None:
    if template.is_builtin:
        raise HTTPException(
            status_code=400,
            detail="Built-in templates can't be deleted — reset them instead",
        )
    delete_template(session, template)
