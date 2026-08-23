import asyncio
import base64
import json
import threading
from typing import ClassVar

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from sqlmodel import Session
from starlette.testclient import WebSocketTestSession

from meetwrite.core.events import EventHub
from meetwrite.core.ports import KeyStoreError
from meetwrite.db.models import Entry
from meetwrite.features.transcription import router as transcription_router
from meetwrite.features.transcription.services import commit_line, line_payload
from meetwrite.features.transcription.session import TranscriptionUnavailable
from tests.conftest import FakeKeyStore, create_entry

PCM = b"\x01\x00"
PCM_B64 = base64.b64encode(PCM).decode("ascii")


class StubRecordingSession:
    instances: ClassVar[list["StubRecordingSession"]] = []
    instance_created: ClassVar[threading.Event] = threading.Event()
    stop_error: ClassVar[TranscriptionUnavailable | None] = None

    def __init__(self, **configuration: object) -> None:
        self.configuration = configuration
        self.audio: list[tuple[str, bytes]] = []
        self.audio_received = threading.Event()
        self.stop_calls = 0
        StubRecordingSession.instances.append(self)
        StubRecordingSession.instance_created.set()

    async def send_audio(self, source: str, pcm16: bytes) -> None:
        self.audio.append((source, pcm16))
        self.audio_received.set()

    async def stop(self) -> None:
        self.stop_calls += 1
        if self.stop_error is not None:
            raise self.stop_error


@pytest.fixture()
def recording_stub(
    monkeypatch: pytest.MonkeyPatch, key_store: FakeKeyStore
) -> type[StubRecordingSession]:
    key_store.set(1, "sk-test")
    StubRecordingSession.instances = []
    StubRecordingSession.instance_created = threading.Event()
    StubRecordingSession.stop_error = None
    monkeypatch.setattr(transcription_router, "RecordingSession", StubRecordingSession)
    return StubRecordingSession


def receive_error_and_close(
    websocket: WebSocketTestSession,
) -> tuple[dict[str, str], int]:
    frame = websocket.receive_json()
    with pytest.raises(WebSocketDisconnect) as closed:
        websocket.receive_json()
    return frame, closed.value.code


def test_websocket_forwards_valid_pcm_and_acknowledges_a_successful_stop(
    client: TestClient, recording_stub: type[StubRecordingSession]
) -> None:
    entry_id = create_entry(client)["id"]

    with client.websocket_connect(f"/entries/{entry_id}/transcribe") as websocket:
        websocket.send_json({"source": "me", "audio": PCM_B64})
        websocket.send_json({"type": "stop"})
        assert websocket.receive_json() == {"type": "stopped"}

    [recording] = recording_stub.instances
    assert recording.audio == [("me", PCM)]
    assert recording.stop_calls == 1
    assert recording.configuration["user_id"] == 1
    assert recording.configuration["entry_id"] == entry_id


def test_recording_receives_the_dictionary_and_title_hint_snapshot(
    client: TestClient, recording_stub: type[StubRecordingSession]
) -> None:
    entry_id = create_entry(client, title="Weekly sync")["id"]
    client.post("/dictionary", json={"values": ["Aarav", "SLA"]})

    with client.websocket_connect(f"/entries/{entry_id}/transcribe") as websocket:
        websocket.send_json({"type": "stop"})
        assert websocket.receive_json() == {"type": "stopped"}

    [recording] = recording_stub.instances
    assert recording.configuration["keywords"] == ["Aarav", "SLA", "Weekly sync"]


@pytest.mark.parametrize(
    ("frame", "message"),
    [
        (
            {"source": "me", "audio": PCM_B64, "unexpected": True},
            "Invalid recording frame",
        ),
        ({"source": "someone", "audio": PCM_B64}, "Invalid recording frame"),
        (
            {"source": "me", "audio": "not base64!"},
            "audio must be base64-encoded PCM16",
        ),
        (
            {"source": "me", "audio": base64.b64encode(b"\x00").decode()},
            "audio must be base64-encoded PCM16",
        ),
    ],
)
def test_websocket_strictly_rejects_bad_frames_and_incomplete_pcm(
    client: TestClient,
    recording_stub: type[StubRecordingSession],
    frame: dict[str, object],
    message: str,
) -> None:
    entry_id = create_entry(client)["id"]

    with client.websocket_connect(f"/entries/{entry_id}/transcribe") as websocket:
        websocket.send_json(frame)
        error, code = receive_error_and_close(websocket)

    assert error == {"type": "error", "message": message}
    assert code == 1008


def test_websocket_reports_specific_prerequisite_close_codes(
    client: TestClient, key_store: FakeKeyStore
) -> None:
    with client.websocket_connect("/entries/999/transcribe") as websocket:
        missing_entry = receive_error_and_close(websocket)
    assert missing_entry == ({"type": "error", "message": "Entry not found"}, 4404)

    entry_id = create_entry(client)["id"]
    with client.websocket_connect(f"/entries/{entry_id}/transcribe") as websocket:
        missing_key = receive_error_and_close(websocket)
    assert missing_key[1] == 4401
    assert "API key" in missing_key[0]["message"]

    key_store.failures["get"] = KeyStoreError("offline")
    with client.websocket_connect(f"/entries/{entry_id}/transcribe") as websocket:
        unavailable_keychain = receive_error_and_close(websocket)
    assert unavailable_keychain == (
        {"type": "error", "message": "Keychain unavailable"},
        1011,
    )
    key_store.failures.clear()

    with client.websocket_connect(
        f"/entries/{entry_id}/transcribe",
        headers={"Origin": "https://evil.example"},
    ) as websocket:
        bad_origin = receive_error_and_close(websocket)
    assert bad_origin == (
        {"type": "error", "message": "Origin is not allowed"},
        1008,
    )


def test_stop_ack_is_not_sent_when_finalization_fails(
    client: TestClient, recording_stub: type[StubRecordingSession]
) -> None:
    entry_id = create_entry(client)["id"]
    recording_stub.stop_error = TranscriptionUnavailable("finalization failed")

    with client.websocket_connect(f"/entries/{entry_id}/transcribe") as websocket:
        websocket.send_json({"type": "stop"})
        error, code = receive_error_and_close(websocket)

    assert error == {"type": "error", "message": "finalization failed"}
    assert code == 1011


def test_only_one_recording_can_hold_an_entry_lease(
    client: TestClient, recording_stub: type[StubRecordingSession]
) -> None:
    entry_id = create_entry(client)["id"]

    with client.websocket_connect(f"/entries/{entry_id}/transcribe") as first:
        first.send_json({"source": "me", "audio": PCM_B64})
        assert recording_stub.instance_created.wait(timeout=1)
        assert recording_stub.instances[0].audio_received.wait(timeout=1)

        with client.websocket_connect(f"/entries/{entry_id}/transcribe") as second:
            error, code = receive_error_and_close(second)
        assert error == {
            "type": "error",
            "message": "This entry is already being recorded",
        }
        assert code == 4409
        assert len(recording_stub.instances) == 1

        first.send_json({"type": "stop"})
        assert first.receive_json() == {"type": "stopped"}


class ConnectedRequest:
    async def is_disconnected(self) -> bool:
        return False


def decode_sse(frame: str) -> dict[str, object]:
    return json.loads(frame.removeprefix("data: "))


def test_sse_filters_subscribe_snapshot_duplicates_then_emits_the_final_shape(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    entry_id = create_entry(client)["id"]
    runtime = client.app.state.runtime
    first, created = commit_line(
        runtime.engine,
        user_id=1,
        entry_id=entry_id,
        sequence=1,
        source="me",
        text="already saved",
    )
    assert created is True

    read_snapshot = transcription_router.list_lines

    def snapshot_with_racing_events(
        session: Session, user_id: int, current_entry_id: int
    ):
        lines = read_snapshot(session, user_id, current_entry_id)
        runtime.transcript_events.publish(
            entry_id,
            {
                "type": "final",
                "item_id": "first",
                "line": line_payload(first),
                "_sequence": 1,
            },
        )
        runtime.transcript_events.publish(
            entry_id,
            {
                "type": "delta",
                "source": "me",
                "item_id": "first",
                "sequence": 1,
                "delta": "already in snapshot",
                "_sequence": 1,
            },
        )
        runtime.transcript_events.publish(
            entry_id,
            {
                "type": "delta",
                "source": "them",
                "item_id": "second",
                "sequence": 2,
                "delta": "still active",
                "_sequence": 2,
            },
        )
        return lines

    monkeypatch.setattr(transcription_router, "list_lines", snapshot_with_racing_events)

    with Session(runtime.engine) as session:
        entry = session.get(Entry, entry_id)
        assert entry is not None
        response = transcription_router.transcript_events(
            ConnectedRequest(),
            entry,
            session,
            runtime,  # type: ignore[arg-type]
        )

    async def run() -> None:
        events = response.body_iterator.__aiter__()
        resync = decode_sse(await events.__anext__())
        assert resync == {"type": "resync", "lines": [line_payload(first)]}

        active_delta = decode_sse(await events.__anext__())
        assert active_delta == {
            "type": "delta",
            "source": "them",
            "item_id": "second",
            "sequence": 2,
            "delta": "still active",
        }

        second, second_created = commit_line(
            runtime.engine,
            user_id=1,
            entry_id=entry_id,
            sequence=2,
            source="them",
            text="new line",
        )
        assert second_created is True
        runtime.transcript_events.publish(
            entry_id,
            {
                "type": "final",
                "item_id": "second",
                "line": line_payload(second),
                "_sequence": 2,
            },
        )

        final = decode_sse(await events.__anext__())
        assert final == {
            "type": "final",
            "item_id": "second",
            "line": line_payload(second),
        }
        assert "_sequence" not in final
        await events.aclose()  # type: ignore[attr-defined]

    asyncio.run(run())


def test_bounded_event_hub_forces_an_overflowed_reader_to_reconnect() -> None:
    hub = EventHub[dict[str, object]](queue_size=1)
    stale_reader = hub.subscribe(1)

    hub.publish(1, {"type": "delta", "delta": "first"})
    hub.publish(1, {"type": "delta", "delta": "overflow"})

    assert stale_reader.get_nowait() is None
    hub.unsubscribe(1, stale_reader)

    reconnected = hub.subscribe(1)
    event = {"type": "delta", "delta": "current"}
    hub.publish(1, event)
    assert reconnected.get_nowait() == event
    hub.unsubscribe(1, reconnected)
