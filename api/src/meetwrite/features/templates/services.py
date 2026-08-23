"""User-scoped template persistence."""

import logging
import unicodedata

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from meetwrite.db.models import Template
from meetwrite.features.templates.catalog import BUILTIN_BY_ID, BUILTIN_TEMPLATES
from meetwrite.features.templates.schemas import TemplateCreate, TemplateUpdate

logger = logging.getLogger(__name__)


class TemplateNameConflict(Exception):
    pass


class InvalidTemplateName(Exception):
    pass


class MissingCatalogTemplate(Exception):
    pass


def normalize_name(name: str) -> tuple[str, str]:
    display_name = " ".join(name.split())
    normalized_name = unicodedata.normalize("NFKC", display_name).casefold()
    if not display_name or len(normalized_name) > 100:
        raise InvalidTemplateName
    return display_name, normalized_name


def seed_builtin_templates(session: Session, user_id: int) -> None:
    existing = set(
        session.exec(select(Template.id).where(Template.user_id == user_id)).all()
    )
    for order, catalog_template in enumerate(BUILTIN_TEMPLATES):
        if catalog_template.id in existing:
            continue
        name, normalized_name = normalize_name(catalog_template.name)
        session.add(
            Template(
                user_id=user_id,
                id=catalog_template.id,
                name=name,
                normalized_name=normalized_name,
                description=catalog_template.description,
                instructions=catalog_template.instructions,
                is_builtin=True,
                sort_order=order,
            )
        )
    session.flush()


def list_templates(session: Session, user_id: int) -> list[Template]:
    return list(
        session.exec(
            select(Template)
            .where(Template.user_id == user_id)
            .order_by(
                col(Template.is_builtin).desc(),
                col(Template.sort_order),
                col(Template.created_at),
                col(Template.id),
            )
        ).all()
    )


def get_template(session: Session, user_id: int, template_id: str) -> Template | None:
    return session.get(Template, (user_id, template_id))


def _slug(name: str) -> str:
    characters: list[str] = []
    for character in unicodedata.normalize("NFKC", name).casefold():
        if character.isalnum():
            characters.append(character)
        elif characters and characters[-1] != "-":
            characters.append("-")
    return "".join(characters).strip("-") or "template"


def _next_custom_id(session: Session, user_id: int, name: str) -> str:
    base = f"custom-{_slug(name)}"[:80].rstrip("-")
    candidate = base
    suffix = 2
    while get_template(session, user_id, candidate) is not None:
        marker = f"-{suffix}"
        candidate = f"{base[: 80 - len(marker)].rstrip('-')}{marker}"
        suffix += 1
    return candidate


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise TemplateNameConflict from error


def create_template(
    session: Session, user_id: int, payload: TemplateCreate
) -> Template:
    name, normalized_name = normalize_name(payload.name)
    template = Template(
        user_id=user_id,
        id=_next_custom_id(session, user_id, name),
        name=name,
        normalized_name=normalized_name,
        description=payload.description.strip(),
        instructions=payload.instructions.strip(),
        is_builtin=False,
    )
    session.add(template)
    _commit(session)
    session.refresh(template)
    logger.info("template.created user_id=%s", user_id)
    return template


def update_template(
    session: Session, template: Template, payload: TemplateUpdate
) -> Template:
    if payload.name is not None:
        template.name, template.normalized_name = normalize_name(payload.name)
    if payload.description is not None:
        template.description = payload.description.strip()
    if payload.instructions is not None:
        template.instructions = payload.instructions.strip()
    session.add(template)
    _commit(session)
    session.refresh(template)
    logger.info("template.updated user_id=%s", template.user_id)
    return template


def reset_template(session: Session, template: Template) -> Template:
    catalog_template = BUILTIN_BY_ID.get(template.id)
    if catalog_template is None:
        raise MissingCatalogTemplate
    template.name, template.normalized_name = normalize_name(catalog_template.name)
    template.description = catalog_template.description
    template.instructions = catalog_template.instructions
    session.add(template)
    _commit(session)
    session.refresh(template)
    logger.info("template.reset user_id=%s", template.user_id)
    return template


def delete_template(session: Session, template: Template) -> None:
    session.delete(template)
    session.commit()
    logger.info("template.deleted user_id=%s", template.user_id)
