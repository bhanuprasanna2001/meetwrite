import base64

import pytest
from fastapi.testclient import TestClient

from meetwrite.integrations.filesystem_audio import FileAudioStore
from tests.conftest import create_entry


def append_audio(client: TestClient, entry_id: int, pcm: bytes):
    return client.post(
        f"/entries/{entry_id}/audio",
        json={"audio": base64.b64encode(pcm).decode("ascii")},
    )


def test_audio_round_trips_as_one_append_only_recording(client: TestClient) -> None:
    entry_id = create_entry(client)["id"]
    half_second = b"\x01\x00" * 12_000

    assert append_audio(client, entry_id, half_second).status_code == 204
    assert append_audio(client, entry_id, half_second).status_code == 204
    assert client.get(f"/entries/{entry_id}/audio").json() == {"duration_s": 1.0}

    response = client.get(f"/entries/{entry_id}/audio/file")
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content[:4] == b"RIFF"
    assert response.content[8:12] == b"WAVE"
    assert response.content[44:] == half_second * 2


@pytest.mark.parametrize("encoded", ["not base64!", base64.b64encode(b"\x00").decode()])
def test_audio_rejects_malformed_or_incomplete_pcm(
    client: TestClient, encoded: str
) -> None:
    entry_id = create_entry(client)["id"]

    response = client.post(f"/entries/{entry_id}/audio", json={"audio": encoded})

    assert response.status_code == 400
    assert response.json() == {"detail": "audio must be base64-encoded PCM16"}
    assert client.get(f"/entries/{entry_id}/audio").json() == {"duration_s": 0.0}


def test_missing_audio_and_entry_deletion_have_clear_results(
    client: TestClient, audio_store: FileAudioStore
) -> None:
    entry_id = create_entry(client)["id"]
    assert client.get(f"/entries/{entry_id}/audio").json() == {"duration_s": 0.0}
    assert client.get(f"/entries/{entry_id}/audio/file").status_code == 404

    append_audio(client, entry_id, b"\x00\x00")
    path = audio_store.path(1, entry_id)
    assert path.is_file()

    assert client.delete(f"/entries/{entry_id}").status_code == 204
    assert not path.exists()
    assert client.get(f"/entries/{entry_id}/audio").status_code == 404


def test_failed_audio_deletion_keeps_the_entry_reachable_for_a_retry(
    client: TestClient,
    audio_store: FileAudioStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry_id = create_entry(client)["id"]
    append_audio(client, entry_id, b"\x00\x00")
    path = audio_store.path(1, entry_id)

    def fail_cleanup(_user_id: int, _entry_id: int) -> None:
        raise OSError("disk unavailable")

    monkeypatch.setattr(audio_store, "delete", fail_cleanup)

    response = client.delete(f"/entries/{entry_id}")

    assert response.status_code == 500
    assert response.json() == {
        "detail": "The recording could not be deleted — try again"
    }
    assert client.get(f"/entries/{entry_id}").status_code == 200
    assert path.is_file()
