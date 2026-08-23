import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from meetwrite.db.models import Preferences
from tests.conftest import acting_as

DEFAULTS = {
    "theme": "light",
    "note_font": "lato",
    "note_font_size": 16,
    "enter_meeting_on_record": False,
    "ai_enabled": True,
    "daily_note_enabled": False,
    "daily_note_folder_id": None,
    "daily_note_time": "08:00",
}

DARK = {
    "theme": "dark",
    "note_font": "mono",
    "note_font_size": 24,
    "enter_meeting_on_record": True,
    "ai_enabled": False,
    "daily_note_enabled": True,
    "daily_note_folder_id": None,
    "daily_note_time": "21:30",
}


def test_preferences_have_defaults_before_onboarding(client: TestClient) -> None:
    assert client.get("/me").status_code == 404
    assert client.get("/settings").json() == DEFAULTS


def test_put_replaces_and_persists_all_preferences(client: TestClient) -> None:
    saved = client.put("/settings", json=DARK)

    assert saved.status_code == 200
    assert saved.json() == DARK
    assert client.get("/settings").json() == DARK


def test_preferences_are_scoped_to_the_current_user(client: TestClient) -> None:
    client.put("/settings", json=DARK)

    with acting_as(client, 2):
        assert client.get("/settings").json() == DEFAULTS
        client.put("/settings", json={**DEFAULTS, "note_font": "serif"})

    assert client.get("/settings").json() == DARK
    with Session(client.app.state.runtime.engine) as session:
        assert [row.user_id for row in session.exec(select(Preferences)).all()] == [
            1,
            2,
        ]


def test_daily_note_folder_must_exist(client: TestClient) -> None:
    folder_id = client.post("/folders", json={"name": "Journal"}).json()["id"]
    saved = client.put(
        "/settings", json={**DEFAULTS, "daily_note_folder_id": folder_id}
    )
    assert saved.status_code == 200
    assert saved.json()["daily_note_folder_id"] == folder_id

    response = client.put("/settings", json={**DEFAULTS, "daily_note_folder_id": 999})
    assert response.status_code == 422
    # The rejected save changed nothing.
    assert client.get("/settings").json()["daily_note_folder_id"] == folder_id


def test_deleting_the_daily_folder_clears_the_reference(
    client: TestClient,
) -> None:
    folder_id = client.post("/folders", json={"name": "Journal"}).json()["id"]
    client.put("/settings", json={**DEFAULTS, "daily_note_folder_id": folder_id})

    assert client.delete(f"/folders/{folder_id}").status_code == 204

    assert client.get("/settings").json()["daily_note_folder_id"] is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("theme", "blue"),
        ("note_font", "comic sans"),
        ("note_font_size", 17),
        ("daily_note_time", "8am"),
        ("daily_note_time", "24:00"),
        ("daily_note_time", "12:60"),
    ],
)
def test_preferences_reject_invalid_domain_values(
    client: TestClient, field: str, value: str | int
) -> None:
    assert client.put("/settings", json={**DEFAULTS, field: value}).status_code == 422
