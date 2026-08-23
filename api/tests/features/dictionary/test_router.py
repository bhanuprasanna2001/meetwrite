"""The dictionary is user-scoped, normalized, and deterministic."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from meetwrite.db.models import DictionaryTerm
from meetwrite.features.dictionary.services import DICTIONARY_MAX_TERMS
from tests.conftest import acting_as


def listed_terms(client: TestClient) -> list[dict]:
    response = client.get("/dictionary")
    assert response.status_code == 200
    return response.json()


def test_terms_are_normalized_deduplicated_and_kept_in_saved_order(
    client: TestClient,
) -> None:
    response = client.post(
        "/dictionary",
        json={"values": ["  Aarav   Nair  ", "Q3 planning", "Q3 PLANNING", "café"]},
    )
    assert response.status_code == 201
    assert [term["value"] for term in response.json()] == [
        "Aarav Nair",
        "Q3 planning",
        "café",
    ]

    # A decomposed "café" and a different-cased repeat both match the stored
    # term, so the batch is idempotent and keeps the saved order.
    added = client.post(
        "/dictionary", json={"values": ["cafe\u0301", "aarav nair", "SLA"]}
    )
    assert added.status_code == 201
    assert [term["value"] for term in added.json()] == [
        "Aarav Nair",
        "Q3 planning",
        "café",
        "SLA",
    ]


def test_invalid_terms_are_rejected_without_partial_changes(
    client: TestClient,
) -> None:
    for values in (
        [""],
        ["   "],
        ["a" * 101],
        ["<tag>"],
        ["line\nbreak"],
        ["tab\tchar"],
        ["valid", "line\nbreak"],
    ):
        response = client.post("/dictionary", json={"values": values})
        assert response.status_code == 422
    assert listed_terms(client) == []


def test_terms_are_scoped_to_the_user(client: TestClient) -> None:
    client.post("/dictionary", json={"values": ["Zoom"]})

    with acting_as(client, 2):
        assert listed_terms(client) == []
        created = client.post("/dictionary", json={"values": ["Slack"]})
        other_term_id = created.json()[0]["id"]
        assert client.delete(f"/dictionary/{other_term_id}").status_code == 204

    assert [term["value"] for term in listed_terms(client)] == ["Zoom"]


def test_delete_removes_one_term_and_missing_terms_404(client: TestClient) -> None:
    terms = client.post("/dictionary", json={"values": ["One", "Two"]}).json()

    assert client.delete(f"/dictionary/{terms[0]['id']}").status_code == 204
    assert [term["value"] for term in listed_terms(client)] == ["Two"]
    assert client.delete("/dictionary/999").status_code == 404

    with acting_as(client, 2):
        assert client.delete(f"/dictionary/{terms[1]['id']}").status_code == 404


def test_dictionary_caps_the_total_term_count(client: TestClient) -> None:
    with Session(client.app.state.runtime.engine) as session:
        session.add_all(
            DictionaryTerm(
                user_id=1, value=f"Term {index}", normalized_value=f"term {index}"
            )
            for index in range(DICTIONARY_MAX_TERMS)
        )
        session.commit()

    full = client.post("/dictionary", json={"values": ["One more"]})
    assert full.status_code == 400
    assert "full" in full.json()["detail"].lower()

    # Re-adding an existing word while full is a no-op, not an error.
    duplicate = client.post("/dictionary", json={"values": ["TERM 0"]})
    assert duplicate.status_code == 201
    assert len(duplicate.json()) == DICTIONARY_MAX_TERMS
