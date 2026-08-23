"""The daily note: one call per day, one note per day, ever after."""

from fastapi.testclient import TestClient

from tests.conftest import create_entry


def test_daily_note_is_created_once_and_reused(client: TestClient) -> None:
    first = client.post("/entries/daily", json={"date": "2026-08-22"})
    second = client.post("/entries/daily", json={"date": "2026-08-22"})

    assert first.status_code == 200
    assert first.json()["created"] is True
    assert second.status_code == 200
    assert second.json()["created"] is False
    assert second.json()["entry"]["id"] == first.json()["entry"]["id"]

    # The title is the date itself — stable and sortable.
    assert first.json()["entry"]["title"] == "2026-08-22"
    assert first.json()["entry"]["folder_id"] == client.get("/folders").json()[0]["id"]

    # The day template is stamped with the date and carries the sections.
    note_md = first.json()["entry"]["note_md"]
    assert "created: 2026-08-22" in note_md
    assert "## Core" in note_md
    assert "## Shutdown" in note_md


def test_daily_notes_for_different_days_are_different_entries(
    client: TestClient,
) -> None:
    monday = client.post("/entries/daily", json={"date": "2026-08-24"}).json()
    tuesday = client.post("/entries/daily", json={"date": "2026-08-25"}).json()

    assert monday["created"] is True
    assert tuesday["created"] is True
    assert tuesday["entry"]["id"] != monday["entry"]["id"]

    # Both days appear in history; the newest day is first.
    ids = [entry["id"] for entry in client.get("/entries").json()]
    assert ids[:2] == [tuesday["entry"]["id"], monday["entry"]["id"]]


def test_daily_note_lands_in_the_requested_folder(client: TestClient) -> None:
    folder_id = client.post("/folders", json={"name": "Journal"}).json()["id"]

    daily = client.post(
        "/entries/daily", json={"date": "2026-08-22", "folder_id": folder_id}
    ).json()

    assert daily["entry"]["folder_id"] == folder_id


def test_daily_note_rejects_bad_dates_and_unknown_folders(
    client: TestClient,
) -> None:
    assert client.post("/entries/daily", json={"date": "2026-02-30"}).status_code == 422
    assert client.post("/entries/daily", json={"date": "tomorrow"}).status_code == 422
    assert (
        client.post(
            "/entries/daily", json={"date": "2026-08-22", "folder_id": 999}
        ).status_code
        == 404
    )


def test_ordinary_notes_never_take_a_daily_date(client: TestClient) -> None:
    ordinary = create_entry(client)
    assert ordinary["title"] != "2026-08-22"
    # The daily call does not collide with ordinary notes.
    daily = client.post("/entries/daily", json={"date": "2026-08-22"}).json()
    assert daily["entry"]["id"] != ordinary["id"]
