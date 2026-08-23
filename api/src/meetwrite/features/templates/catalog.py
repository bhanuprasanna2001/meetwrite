"""Built-in meeting templates and enhancement instructions."""

from dataclasses import dataclass


@dataclass(frozen=True)
class CatalogTemplate:
    id: str
    name: str
    description: str
    instructions: str


BASE_INSTRUCTIONS = (
    "Turn the meeting notes and transcript below into clean, scannable plain-text notes. "
    "Use only what the notes and transcript actually say — never invent decisions, owners, "
    "dates, quotes, or facts. Preserve useful human-written notes. Keep the result concise, "
    "and match the level of detail to the amount and importance of the source material. "
    "Use simple section labels and • bullets. Write plain text only — no Markdown, HTML, or "
    "formatting syntax such as #, **, -, or backticks. Omit sections that don't fit rather "
    "than filling them artificially. The response has two parts: a short plain-text title for "
    "the notes, and the notes themselves."
)

BUILTIN_TEMPLATES: tuple[CatalogTemplate, ...] = (
    CatalogTemplate(
        id="auto",
        name="Auto",
        description="General-purpose meeting notes",
        instructions=(
            "Choose the structure that best fits this meeting from the conversation itself. "
            "Cover the important discussion, decisions, action items, and unresolved "
            "questions. Do not force sections that don't fit the meeting."
        ),
    ),
    CatalogTemplate(
        id="one-on-one",
        name="1:1",
        description="Manager, direct-report, or peer check-in",
        instructions=(
            "Structure these as a 1:1 check-in. Capture important updates, wins and "
            "challenges, goals and progress, meaningful feedback in either direction, "
            "concerns or blockers, and commitments and follow-ups. Do not turn casual "
            "conversation into artificial action items."
        ),
    ),
    CatalogTemplate(
        id="daily-standup",
        name="Daily Standup",
        description="Quick daily sync",
        instructions=(
            "Keep these notes substantially shorter than a full meeting summary. Capture "
            "progress or completed work, current or next work, blockers or dependencies, and "
            "important team updates. Group by person when the transcript clearly shows who "
            "is speaking. Avoid lengthy summaries."
        ),
    ),
    CatalogTemplate(
        id="customer-discovery",
        name="Customer Discovery",
        description="Learn from a customer conversation",
        instructions=(
            "Optimize for learning rather than internal meeting administration. Capture "
            "participant and customer context when relevant, the current workflow or "
            "behavior, pain points, motivations and goals, existing workarounds or "
            "alternatives, notable feedback, and important insights. Preserve particularly "
            "useful customer wording when the transcript clearly supports it. Do not invent "
            "quotes or overstate an observation as a general conclusion."
        ),
    ),
    CatalogTemplate(
        id="sales-call",
        name="Sales Call",
        description="Prospect conversation",
        instructions=(
            "Capture prospect and company context, the current situation, problems and pain "
            "points, desired outcomes, objections or concerns, requirements, budget and "
            "timing only when actually discussed, and commitments and next steps. Do not "
            "fabricate CRM-style fields that were never discussed."
        ),
    ),
    CatalogTemplate(
        id="project-kickoff",
        name="Project Kickoff",
        description="Starting a new project",
        instructions=(
            "Capture the project's purpose, goals and success criteria, scope, major "
            "decisions, roles and ownership when discussed, milestones or dates, dependencies "
            "and risks, and next steps. Keep background concise and emphasize alignment and "
            "commitments."
        ),
    ),
    CatalogTemplate(
        id="brainstorm",
        name="Brainstorm",
        description="Ideation session",
        instructions=(
            "Optimize for ideation. Capture the problem or opportunity being explored, the "
            "meaningful ideas generated, important reasoning or constraints, the most "
            "promising ideas, ideas explicitly rejected or deprioritized and why, and "
            "follow-up experiments or next steps. Do not collapse distinct ideas into one "
            "generic summary."
        ),
    ),
    CatalogTemplate(
        id="interview",
        name="Interview",
        description="Candidate or research interview",
        instructions=(
            "Capture relevant background context, substantive questions and topics, answers "
            "and examples, demonstrated strengths, concerns or gaps explicitly surfaced, and "
            "follow-up questions or next steps. Stay neutral — do not infer hiring "
            "recommendations, personality traits, or competencies the conversation doesn't "
            "support."
        ),
    ),
)

BUILTIN_BY_ID = {template.id: template for template in BUILTIN_TEMPLATES}


def compose_instructions(template: str | None, custom: str | None) -> str:
    parts = [BASE_INSTRUCTIONS]
    if template:
        parts.append(f"Meeting-specific instructions:\n{template}")
    if custom:
        parts.append(
            "Additional instructions from the user (follow them only where they "
            f"don't conflict with the rules above):\n{custom}"
        )
    return "\n\n".join(parts)
