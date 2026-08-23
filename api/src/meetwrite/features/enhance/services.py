"""Note-enhancement orchestration and persistence."""

import json

from sqlmodel import Session, col, select

from meetwrite.core.ports import AiProvider
from meetwrite.core.time import utc_now
from meetwrite.db.models import EnhancedVersion, Entry, Template
from meetwrite.features.entries.services import meeting_source, transcript_text
from meetwrite.features.templates.catalog import compose_instructions

MIN_WORDS = 10
MIN_CHARS = 60

ENHANCED_OUTPUT_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "title": {
            "type": "string",
            "maxLength": 200,
            "description": "A short plain-text title for these notes, a few words.",
        },
        "notes": {
            "type": "string",
            "minLength": 1,
            "description": "The enhanced meeting notes themselves, plain text only.",
        },
    },
    "required": ["title", "notes"],
    "additionalProperties": False,
}


class EnhanceFormatError(Exception):
    pass


def has_enough_source(session: Session, entry: Entry) -> bool:
    assert entry.id is not None
    source = f"{entry.note_md or ''} {transcript_text(session, entry.id) or ''}".strip()
    return len(source.split()) >= MIN_WORDS or len(source) >= MIN_CHARS


def enhance_source(session: Session, entry: Entry, limit: int) -> str:
    title = f"# Meeting title\n{entry.title}\n\n" if entry.title else ""
    if len(title) >= limit:
        return title[:limit]
    return title + meeting_source(session, entry, limit - len(title))


def parse_enhanced(output_text: str) -> tuple[str | None, str]:
    try:
        data = json.loads(output_text)
    except (json.JSONDecodeError, TypeError):
        raise EnhanceFormatError from None
    if not isinstance(data, dict):
        raise EnhanceFormatError
    title, notes = data.get("title"), data.get("notes")
    if (
        not isinstance(title, str)
        or len(title.strip()) > 200
        or not isinstance(notes, str)
        or not notes.strip()
    ):
        raise EnhanceFormatError
    return title.strip() or None, notes.strip()


def parse_title(output_text: str) -> str:
    """The single validated string the title utility must produce."""

    try:
        data = json.loads(output_text)
    except (json.JSONDecodeError, TypeError):
        raise EnhanceFormatError from None
    if not isinstance(data, dict):
        raise EnhanceFormatError
    title = data.get("title")
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 200:
        raise EnhanceFormatError
    return title.strip()


def build_enhancement_input(
    session: Session,
    entry: Entry,
    template: Template | None,
    custom: str | None,
    context_limit: int,
) -> tuple[str, str]:
    return (
        compose_instructions(
            template.instructions if template is not None else None, custom
        ),
        enhance_source(session, entry, context_limit),
    )


async def enhance_notes(
    ai: AiProvider,
    user_id: int,
    *,
    instructions: str,
    source: str,
) -> tuple[str | None, str]:
    output = await ai.enhance(
        user_id,
        instructions=instructions,
        source=source,
        schema=ENHANCED_OUTPUT_SCHEMA,
    )
    return parse_enhanced(output)


def create_version(
    session: Session,
    entry: Entry,
    title: str | None,
    content: str,
    template_id: str | None,
) -> EnhancedVersion:
    assert entry.id is not None
    version = EnhancedVersion(
        entry_id=entry.id,
        user_id=entry.user_id,
        title=title,
        content=content,
        template_id=template_id,
    )
    if not entry.title:
        entry.title = title
    entry.updated_at = utc_now()
    session.add(version)
    session.add(entry)
    session.commit()
    session.refresh(version)
    return version


def list_versions(
    session: Session, user_id: int, entry_id: int
) -> list[EnhancedVersion]:
    return list(
        session.exec(
            select(EnhancedVersion)
            .where(
                EnhancedVersion.entry_id == entry_id,
                EnhancedVersion.user_id == user_id,
            )
            .order_by(col(EnhancedVersion.created_at), col(EnhancedVersion.id))
        ).all()
    )


def get_version(
    session: Session, user_id: int, version_id: int
) -> EnhancedVersion | None:
    return session.exec(
        select(EnhancedVersion).where(
            EnhancedVersion.id == version_id,
            EnhancedVersion.user_id == user_id,
        )
    ).first()


def update_version(
    session: Session, version: EnhancedVersion, content: str
) -> EnhancedVersion:
    version.content = content
    entry = session.exec(
        select(Entry).where(
            Entry.id == version.entry_id,
            Entry.user_id == version.user_id,
        )
    ).first()
    if entry is not None:
        entry.updated_at = utc_now()
    session.add(version)
    session.commit()
    session.refresh(version)
    return version
