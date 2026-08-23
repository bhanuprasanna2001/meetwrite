"""Notes-only mode must block every endpoint that can reach the AI provider."""

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from tests.conftest import FakeKeyStore, ScriptedAiProvider, create_entry


def set_ai_enabled(client: TestClient, ai_enabled: bool) -> None:
    response = client.put(
        "/settings",
        json={
            "theme": "light",
            "note_font": "lato",
            "note_font_size": 16,
            "enter_meeting_on_record": False,
            "ai_enabled": ai_enabled,
            "daily_note_enabled": False,
        },
    )
    assert response.status_code == 200


def receive_error_and_close(websocket) -> tuple[dict[str, str], int]:
    frame = websocket.receive_json()
    with pytest.raises(WebSocketDisconnect) as closed:
        websocket.receive_json()
    return frame, closed.value.code


def test_ai_endpoints_are_locked_while_ai_is_disabled(
    client: TestClient,
    key_store: FakeKeyStore,
    ai_provider: ScriptedAiProvider,
) -> None:
    key_store.set(1, "sk-test")
    entry_id = create_entry(client)["id"]
    chat_id = client.post(f"/entries/{entry_id}/chats").json()["id"]
    set_ai_enabled(client, ai_enabled=False)

    message = client.post(f"/chats/{chat_id}/messages", json={"content": "hello"})
    assert message.status_code == 403

    enhance = client.post(f"/entries/{entry_id}/enhance")
    assert enhance.status_code == 403

    with client.websocket_connect(f"/entries/{entry_id}/transcribe") as websocket:
        error, code = receive_error_and_close(websocket)
    assert error == {"type": "error", "message": "AI features are turned off"}
    assert code == 4403

    # The gate fires before any provider work: zero calls, zero new rows.
    assert ai_provider.chat_calls == []
    assert ai_provider.enhance_calls == []
    assert client.get(f"/chats/{chat_id}/messages").json() == []


def test_reenabling_ai_restores_the_endpoints(
    client: TestClient,
    key_store: FakeKeyStore,
    ai_provider: ScriptedAiProvider,
) -> None:
    key_store.set(1, "sk-test")
    ai_provider.chat_chunks = ["Hello", " there"]
    entry_id = create_entry(client)["id"]
    set_ai_enabled(client, ai_enabled=False)

    chat_id = client.post(f"/entries/{entry_id}/chats").json()["id"]
    blocked = client.post(f"/chats/{chat_id}/messages", json={"content": "hello"})
    assert blocked.status_code == 403

    set_ai_enabled(client, ai_enabled=True)

    response = client.post(f"/chats/{chat_id}/messages", json={"content": "hello"})
    assert response.status_code == 200
    assert "Hello there" in response.text
    assert len(ai_provider.chat_calls) == 1
