import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from meetwrite.core.ports import AiProviderError
from meetwrite.db.models import EnhancedVersion
from tests.conftest import ScriptedAiProvider, acting_as, create_entry

TEN_WORDS = "one two three four five six seven eight nine ten"


def create_source_entry(
    client: TestClient, *, note_md: str = TEN_WORDS, title: str | None = None
) -> dict:
    return create_entry(client, note_md=note_md, title=title)


def versions(client: TestClient, entry_id: int) -> list[dict]:
    response = client.get(f"/entries/{entry_id}/enhanced-versions")
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize(
    "note_md",
    ["", "short source", " \n\t" * 30],
    ids=["empty", "below-threshold", "whitespace-only"],
)
def test_enhance_rejects_sources_without_meaningful_content(
    client: TestClient, ai_provider: ScriptedAiProvider, note_md: str
) -> None:
    entry = create_source_entry(client, note_md=note_md)

    response = client.post(f"/entries/{entry['id']}/enhance")

    assert response.status_code == 400
    assert "Nothing to enhance" in response.json()["detail"]
    assert ai_provider.enhance_calls == []
    assert versions(client, entry["id"]) == []


@pytest.mark.parametrize(
    "note_md",
    [TEN_WORDS, "x" * 60],
    ids=["word-threshold", "character-threshold"],
)
def test_enhance_accepts_either_source_threshold(
    client: TestClient, ai_provider: ScriptedAiProvider, note_md: str
) -> None:
    entry = create_source_entry(client, note_md=note_md)

    response = client.post(f"/entries/{entry['id']}/enhance")

    assert response.status_code == 200
    assert len(ai_provider.enhance_calls) == 1


def test_prompt_layers_factual_rules_template_and_custom_request(
    client: TestClient, ai_provider: ScriptedAiProvider
) -> None:
    template = client.post(
        "/templates",
        json={
            "name": "Decision lens",
            "instructions": "Highlight decisions and their stated owners.",
        },
    ).json()
    entry = create_source_entry(
        client, note_md="The team decided to ship Tuesday and Ada owns release notes."
    )

    response = client.post(
        f"/entries/{entry['id']}/enhance",
        json={
            "template_id": template["id"],
            "instructions": "Also mention unresolved blockers.",
        },
    )

    assert response.status_code == 200
    assert response.json()["template_id"] == template["id"]
    [call] = ai_provider.enhance_calls
    instructions = call["instructions"]
    assert isinstance(instructions, str)
    factual_rule = instructions.index("never invent")
    template_rule = instructions.index("Highlight decisions")
    custom_rule = instructions.index("Also mention unresolved blockers")
    assert factual_rule < template_rule < custom_rule
    assert call["user_id"] == 1
    assert "ship Tuesday" in str(call["source"])
    schema = call["schema"]
    assert isinstance(schema, dict)
    assert schema["required"] == ["title", "notes"]


def test_unknown_template_stops_before_calling_the_provider(
    client: TestClient, ai_provider: ScriptedAiProvider
) -> None:
    entry = create_source_entry(client)

    response = client.post(
        f"/entries/{entry['id']}/enhance", json={"template_id": "missing"}
    )

    assert response.status_code == 400
    assert "Unknown template" in response.json()["detail"]
    assert ai_provider.enhance_calls == []
    assert versions(client, entry["id"]) == []


def test_success_persists_a_version_and_applies_the_entry_title_policy(
    client: TestClient, ai_provider: ScriptedAiProvider
) -> None:
    ai_provider.structured_outputs.extend(
        [
            json.dumps({"title": "Generated title", "notes": "Generated notes"}),
            json.dumps({"title": "Alternative title", "notes": "Alternative notes"}),
        ]
    )
    untitled = create_source_entry(client)
    titled = create_source_entry(client, title="Human title")

    generated = client.post(f"/entries/{untitled['id']}/enhance")
    alternative = client.post(f"/entries/{titled['id']}/enhance")

    assert generated.status_code == alternative.status_code == 200
    assert generated.json()["content"] == "Generated notes"
    assert generated.json()["template_id"] is None
    assert generated.json()["created_at"].endswith("Z")
    assert client.get(f"/entries/{untitled['id']}").json()["title"] == "Generated title"
    assert alternative.json()["title"] == "Alternative title"
    assert client.get(f"/entries/{titled['id']}").json()["title"] == "Human title"
    assert versions(client, untitled["id"]) == [generated.json()]
    assert versions(client, titled["id"]) == [alternative.json()]


def test_versions_and_provider_calls_are_scoped_to_the_current_user(
    client: TestClient, ai_provider: ScriptedAiProvider
) -> None:
    local_entry = create_source_entry(client)
    local_version = client.post(f"/entries/{local_entry['id']}/enhance").json()

    with acting_as(client, 2):
        assert (
            client.get(f"/entries/{local_entry['id']}/enhanced-versions").status_code
            == 404
        )
        assert (
            client.patch(
                f"/enhanced-versions/{local_version['id']}",
                json={"content": "intrusion"},
            ).status_code
            == 404
        )

        other_entry = create_source_entry(client)
        other_version = client.post(f"/entries/{other_entry['id']}/enhance").json()
        assert versions(client, other_entry["id"]) == [other_version]

    assert versions(client, local_entry["id"]) == [local_version]
    assert client.get(f"/entries/{other_entry['id']}").status_code == 404
    assert (
        client.patch(
            f"/enhanced-versions/{other_version['id']}", json={"content": "intrusion"}
        ).status_code
        == 404
    )
    assert [call["user_id"] for call in ai_provider.enhance_calls] == [1, 2]


@pytest.mark.parametrize(
    ("provider_result", "status", "detail"),
    [
        ("not structured JSON", 502, "unreadable"),
        (
            AiProviderError("AI temporarily unavailable", status_code=504),
            504,
            "AI temporarily unavailable",
        ),
    ],
    ids=["structured-output", "provider"],
)
def test_enhance_failure_has_no_persistence_side_effects(
    client: TestClient,
    ai_provider: ScriptedAiProvider,
    provider_result: str | Exception,
    status: int,
    detail: str,
) -> None:
    ai_provider.structured_outputs.append(provider_result)
    entry = create_source_entry(client)
    before = client.get(f"/entries/{entry['id']}").json()

    response = client.post(f"/entries/{entry['id']}/enhance")

    assert response.status_code == status
    assert detail in response.json()["detail"]
    assert versions(client, entry["id"]) == []
    assert client.get(f"/entries/{entry['id']}").json() == before


def test_version_order_has_an_id_tie_breaker_and_content_is_editable(
    client: TestClient, ai_provider: ScriptedAiProvider
) -> None:
    ai_provider.structured_outputs.extend(
        [
            json.dumps({"title": f"Version {number}", "notes": f"Notes {number}"})
            for number in range(1, 4)
        ]
    )
    entry = create_source_entry(client)
    created = [client.post(f"/entries/{entry['id']}/enhance").json() for _ in range(3)]
    tied_at = datetime(2026, 1, 1, tzinfo=UTC)
    with Session(client.app.state.runtime.engine) as session:
        for item in created:
            version = session.get(EnhancedVersion, item["id"])
            assert version is not None
            version.created_at = tied_at
            session.add(version)
        session.commit()

    listed = versions(client, entry["id"])
    assert [item["id"] for item in listed] == sorted(item["id"] for item in created)

    edited_id = listed[1]["id"]
    updated = client.patch(
        f"/enhanced-versions/{edited_id}", json={"content": "Polished by the user"}
    )
    assert updated.status_code == 200
    assert updated.json()["content"] == "Polished by the user"
    refreshed = versions(client, entry["id"])
    assert [item["id"] for item in refreshed] == [item["id"] for item in listed]
    assert (
        next(item for item in refreshed if item["id"] == edited_id)["content"]
        == "Polished by the user"
    )
