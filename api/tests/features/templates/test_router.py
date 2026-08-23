from fastapi.testclient import TestClient
from sqlmodel import Session

from meetwrite.features.templates.services import seed_builtin_templates
from tests.conftest import acting_as


def listed_templates(client: TestClient) -> list[dict]:
    response = client.get("/templates")
    assert response.status_code == 200
    return response.json()


def builtins(client: TestClient) -> list[dict]:
    return [template for template in listed_templates(client) if template["is_builtin"]]


def test_builtin_seed_is_per_user_idempotent_and_preserves_edits(
    client: TestClient,
) -> None:
    original = builtins(client)
    assert original
    edited_id = original[0]["id"]
    edited_instructions = "Keep this user's preferred structure."
    assert (
        client.patch(
            f"/templates/{edited_id}", json={"instructions": edited_instructions}
        ).status_code
        == 200
    )

    with Session(client.app.state.runtime.engine) as session:
        seed_builtin_templates(session, 1)
        seed_builtin_templates(session, 1)
        session.commit()

    local = builtins(client)
    assert [template["id"] for template in local] == [
        template["id"] for template in original
    ]
    assert (
        next(item for item in local if item["id"] == edited_id)["instructions"]
        == edited_instructions
    )

    with acting_as(client, 2):
        with Session(client.app.state.runtime.engine) as session:
            seed_builtin_templates(session, 2)
            seed_builtin_templates(session, 2)
            session.commit()

        other = builtins(client)
        assert [template["id"] for template in other] == [
            template["id"] for template in original
        ]
        assert (
            next(item for item in other if item["id"] == edited_id)["instructions"]
            == original[0]["instructions"]
        )
        client.patch(
            f"/templates/{edited_id}", json={"instructions": "Other user's edit"}
        )

    assert (
        next(item for item in builtins(client) if item["id"] == edited_id)[
            "instructions"
        ]
        == edited_instructions
    )


def test_custom_template_crud_uses_normalized_names_and_deterministic_ids(
    client: TestClient,
) -> None:
    created = client.post(
        "/templates",
        json={
            "name": "  Weekly   Sync  ",
            "description": "  Team checkpoint  ",
            "instructions": "  Focus on risks.  ",
        },
    )

    assert created.status_code == 201
    first = created.json()
    assert first == {
        "id": "custom-weekly-sync",
        "name": "Weekly Sync",
        "description": "Team checkpoint",
        "instructions": "Focus on risks.",
        "is_builtin": False,
    }

    collision = client.post("/templates", json={"name": "Weekly + Sync"})
    assert collision.status_code == 201
    assert collision.json()["id"] == "custom-weekly-sync-2"

    duplicate = client.post("/templates", json={"name": "  WEEKLY sync "})
    assert duplicate.status_code == 400
    assert "already exists" in duplicate.json()["detail"]

    updated = client.patch(
        f"/templates/{first['id']}",
        json={"name": "Roadmap Review", "instructions": "Capture decisions."},
    )
    assert updated.status_code == 200
    assert updated.json()["id"] == first["id"]
    assert updated.json()["name"] == "Roadmap Review"
    assert updated.json()["instructions"] == "Capture decisions."

    custom_ids = [
        template["id"]
        for template in listed_templates(client)
        if not template["is_builtin"]
    ]
    assert custom_ids == [first["id"], collision.json()["id"]]

    assert client.delete(f"/templates/{first['id']}").status_code == 204
    assert (
        client.patch(f"/templates/{first['id']}", json={"name": "Gone"}).status_code
        == 404
    )


def test_builtin_protection_and_reset_are_explicit(client: TestClient) -> None:
    original = builtins(client)[-1]
    template_id = original["id"]

    changed = client.patch(
        f"/templates/{template_id}",
        json={"name": "Personalized built-in", "instructions": "Personal rules"},
    )
    assert changed.status_code == 200
    assert client.delete(f"/templates/{template_id}").status_code == 400

    restored = client.post(f"/templates/{template_id}/reset")
    assert restored.status_code == 200
    assert restored.json() == original

    duplicate = client.post("/templates", json={"name": original["name"].swapcase()})
    assert duplicate.status_code == 400

    custom = client.post("/templates", json={"name": "Private format"}).json()
    assert client.post(f"/templates/{custom['id']}/reset").status_code == 400


def test_template_name_must_contain_visible_text(client: TestClient) -> None:
    response = client.post("/templates", json={"name": " \n\t "})

    assert response.status_code == 422
    assert listed_templates(client) == builtins(client)
