"""Template route dependencies."""

from typing import Annotated

from fastapi import Depends, HTTPException

from meetwrite.db.models import Template
from meetwrite.db.session import DbSession
from meetwrite.features.templates.services import get_template
from meetwrite.features.user.dependencies import LocalUser


def get_template_or_404(
    template_id: str, user: LocalUser, session: DbSession
) -> Template:
    assert user.id is not None
    template = get_template(session, user.id, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


CurrentTemplate = Annotated[Template, Depends(get_template_or_404)]
