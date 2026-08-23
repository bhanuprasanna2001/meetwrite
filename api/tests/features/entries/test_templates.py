"""The one seeding rule: new notes in a folder named LeetCode start from
the problem template; everywhere else they start blank."""

from fastapi.testclient import TestClient

from tests.conftest import create_entry


def test_leetcode_folder_seeds_the_problem_template(client: TestClient) -> None:
    folder_id = client.post("/folders", json={"name": "LeetCode"}).json()["id"]

    created = client.post("/entries", json={"folder_id": folder_id}).json()

    assert "number:" in created["note_md"]
    assert "## Key trick" in created["note_md"]
    assert "## Review log" in created["note_md"]


def test_seeding_matches_the_folder_name_case_insensitively(
    client: TestClient,
) -> None:
    folder_id = client.post("/folders", json={"name": "LEETCODE"}).json()["id"]

    created = client.post("/entries", json={"folder_id": folder_id}).json()

    assert "## Approach" in created["note_md"]


def test_other_folders_and_inbox_start_blank(client: TestClient) -> None:
    journal = client.post("/folders", json={"name": "Journal"}).json()["id"]

    in_journal = client.post("/entries", json={"folder_id": journal}).json()
    in_inbox = create_entry(client)

    assert in_journal["note_md"] is None
    assert in_inbox["note_md"] is None


def test_moving_a_note_does_not_retemplate_it(client: TestClient) -> None:
    folder_id = client.post("/folders", json={"name": "LeetCode"}).json()["id"]
    blank = create_entry(client)

    moved = client.patch(
        f"/entries/{blank['id']}", json={"folder_id": folder_id}
    ).json()

    assert moved["note_md"] is None
