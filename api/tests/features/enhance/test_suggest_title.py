"""Suggest-title: one validated suggestion, never an automatic save."""

from fastapi.testclient import TestClient

from meetwrite.core.ports import AiProviderError
from tests.conftest import ScriptedAiProvider, acting_as, create_entry


def test_suggest_title_returns_one_validated_title(client: TestClient) -> None:
    entry = create_entry(
        client, title="Launch plan", note_md="We ship the beta on Tuesday"
    )

    response = client.post(f"/entries/{entry['id']}/suggest-title")

    assert response.status_code == 200
    title = response.json()["title"]
    assert isinstance(title, str) and 0 < len(title) <= 200
    # A suggestion never writes anything.
    assert client.get(f"/entries/{entry['id']}").json()["title"] == "Launch plan"


def test_suggest_title_requires_ai_enabled(client: TestClient) -> None:
    entry = create_entry(client)
    client.put(
        "/settings",
        json={
            "theme": "light",
            "note_font": "lato",
            "note_font_size": 16,
            "enter_meeting_on_record": False,
            "ai_enabled": False,
            "daily_note_enabled": False,
        },
    )

    assert client.post(f"/entries/{entry['id']}/suggest-title").status_code == 403


def test_suggest_title_reports_unreadable_output_as_a_retryable_error(
    client: TestClient, ai_provider: ScriptedAiProvider
) -> None:
    entry = create_entry(client)
    ai_provider.title_outputs.append("not json")

    assert client.post(f"/entries/{entry['id']}/suggest-title").status_code == 502


def test_suggest_title_reports_provider_failures_with_their_status(
    client: TestClient, ai_provider: ScriptedAiProvider
) -> None:
    entry = create_entry(client)
    ai_provider.title_outputs.append(
        AiProviderError("OpenAI rate limit reached", status_code=429)
    )

    assert client.post(f"/entries/{entry['id']}/suggest-title").status_code == 429


def test_suggest_title_snapshots_the_note_and_transcript(
    client: TestClient, ai_provider: ScriptedAiProvider
) -> None:
    entry = create_entry(client, note_md="decide the review cadence")
    client.post(f"/entries/{entry['id']}/suggest-title")

    assert len(ai_provider.title_calls) == 1
    user_id, source = ai_provider.title_calls[0]
    assert user_id == 1
    assert "decide the review cadence" in source


def test_suggest_title_is_scoped_to_the_entry_owner(client: TestClient) -> None:
    entry = create_entry(client)
    # A second user must not be able to title someone else's note.
    with acting_as(client, 2):
        assert client.post(f"/entries/{entry['id']}/suggest-title").status_code == 404
