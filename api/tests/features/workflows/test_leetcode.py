"""The LeetCode starter: idempotent folder + starter note."""

from fastapi.testclient import TestClient


def test_leetcode_setup_creates_folder_and_starter_once(client: TestClient) -> None:
    first = client.post("/workflows/leetcode")
    second = client.post("/workflows/leetcode")

    assert first.status_code == 200
    body = first.json()
    assert body["folder_created"] is True
    assert body["starter_created"] is True

    # Re-running changes nothing: same folder, no new starter.
    again = second.json()
    assert again["folder_id"] == body["folder_id"]
    assert again["folder_created"] is False
    assert again["starter_created"] is False

    folder_entries = client.get(
        "/entries", params={"folder_id": body["folder_id"]}
    ).json()
    assert [entry["title"] for entry in folder_entries] == ["Getting Started"]
    starter = client.get(f"/entries/{folder_entries[0]['id']}").json()
    # The guide teaches the tag taxonomy and the review cadence.
    assert "status-review" in starter["note_md"]
    assert "confidence-got-it" in starter["note_md"]


def test_leetcode_setup_reuses_an_existing_folder_name(client: TestClient) -> None:
    existing = client.post("/folders", json={"name": "leetcode"}).json()

    result = client.post("/workflows/leetcode").json()

    # The case-insensitive match means no duplicate folder appears.
    assert result["folder_id"] == existing["id"]
    assert result["folder_created"] is False
    assert result["starter_created"] is False
    assert [folder["name"] for folder in client.get("/folders").json()].count(
        "leetcode"
    ) == 1
