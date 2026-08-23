import asyncio
import base64
import json
from collections.abc import Callable
from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from meetwrite.core.audio import SAMPLE_RATE_HZ
from meetwrite.features.transcription.services import list_lines
from meetwrite.features.transcription.session import (
    COMMIT_INTERVAL_PCM_BYTES,
    REALTIME_URL,
    TRANSCRIPTION_DELAY,
    TRANSCRIPTION_LANGUAGES,
    TRANSCRIPTION_PROMPT,
    RecordingSession,
    SourceTranscriber,
    TranscriptionUnavailable,
)
from tests.conftest import create_entry


class FakeSocket:
    def __init__(self, *, auto_ready: bool = True) -> None:
        self.auto_ready = auto_ready
        self.events: asyncio.Queue[str | None] = asyncio.Queue()
        self.sent: list[dict[str, Any]] = []
        self.commit_sent = asyncio.Event()
        self.close_calls = 0
        self.iteration_cancelled = False

    async def send(self, message: str) -> None:
        frame = json.loads(message)
        self.sent.append(frame)
        if frame["type"] == "session.update" and self.auto_ready:
            self.push({"type": "session.updated"})
        if frame["type"] == "input_audio_buffer.commit":
            self.commit_sent.set()

    def push(self, event: dict[str, object]) -> None:
        self.events.put_nowait(json.dumps(event))

    def __aiter__(self) -> "FakeSocket":
        return self

    async def __anext__(self) -> str:
        try:
            event = await self.events.get()
        except asyncio.CancelledError:
            self.iteration_cancelled = True
            raise
        if event is None:
            raise StopAsyncIteration
        return event

    async def close(self) -> None:
        self.close_calls += 1


def make_source(
    monkeypatch: pytest.MonkeyPatch,
    socket: FakeSocket,
    *,
    timeout: float = 0.1,
    keywords: list[str] | None = None,
    on_delta: Callable[..., None] = lambda *_args: None,
    on_committed: Callable[[], int] = lambda: 1,
    on_final: Callable[[str, int, str | None], None] = (
        lambda _item_id, _sequence, _text: None
    ),
) -> tuple[SourceTranscriber, list[tuple[str, dict[str, str], float]]]:
    connections: list[tuple[str, dict[str, str], float]] = []

    async def connect(
        url: str, additional_headers: dict[str, str], open_timeout: float
    ) -> FakeSocket:
        connections.append((url, additional_headers, open_timeout))
        return socket

    monkeypatch.setattr(
        "meetwrite.features.transcription.session.websocket_connect", connect
    )
    return (
        SourceTranscriber(
            source="me",
            api_key="sk-test",
            model="gpt-live-transcribe",
            event_timeout_seconds=timeout,
            keywords=keywords if keywords is not None else [],
            on_delta=on_delta,
            on_committed=on_committed,
            on_final=on_final,
        ),
        connections,
    )


async def spin_until(predicate: Callable[[], bool]) -> None:
    for _ in range(100):
        if predicate():
            return
        await asyncio.sleep(0)
    raise AssertionError("condition was not reached")


def test_adapter_uses_explicit_turns_and_the_shared_24khz_audio_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        socket = FakeSocket()
        transcriber, connections = make_source(
            monkeypatch, socket, keywords=["Zoom", "AC-42"]
        )
        pcm = b"\x01\x00"

        await transcriber.send_audio(pcm)
        await transcriber.close()
        await transcriber.close()

        assert connections == [(REALTIME_URL, {"Authorization": "Bearer sk-test"}, 0.1)]
        session_input = socket.sent[0]["session"]["audio"]["input"]
        assert session_input["format"] == {
            "type": "audio/pcm",
            "rate": SAMPLE_RATE_HZ,
        }
        assert session_input["transcription"] == {
            "model": "gpt-live-transcribe",
            "delay": TRANSCRIPTION_DELAY,
            "languages": TRANSCRIPTION_LANGUAGES,
            "prompt": TRANSCRIPTION_PROMPT,
            "keywords": ["Zoom", "AC-42"],
        }
        assert session_input["turn_detection"] is None
        assert socket.sent[1] == {
            "type": "input_audio_buffer.append",
            "audio": base64.b64encode(pcm).decode("ascii"),
        }
        assert socket.iteration_cancelled is True
        assert socket.close_calls == 1

    asyncio.run(run())


def test_session_update_omits_keywords_when_there_are_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        socket = FakeSocket()
        transcriber, _ = make_source(monkeypatch, socket)

        await transcriber.send_audio(b"\x01\x00")
        await transcriber.close()

        transcription = socket.sent[0]["session"]["audio"]["input"]["transcription"]
        assert "keywords" not in transcription

    asyncio.run(run())


def test_full_audio_turn_is_committed_explicitly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        socket = FakeSocket()
        committed: list[int] = []
        transcriber, _ = make_source(
            monkeypatch,
            socket,
            on_committed=lambda: committed.append(1) or 1,
        )

        sending = asyncio.create_task(
            transcriber.send_audio(b"\x01\x00" * (COMMIT_INTERVAL_PCM_BYTES // 2))
        )
        await socket.commit_sent.wait()
        assert sending.done() is False

        socket.push({"type": "input_audio_buffer.committed", "item_id": "turn"})
        await sending
        await transcriber.close()

        assert committed == [1]

    asyncio.run(run())


def test_overlapping_provider_items_keep_delta_identity_and_ignore_duplicates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        socket = FakeSocket()
        sequences: list[int] = []
        deltas: list[tuple[str, int, str]] = []
        finals: list[tuple[str, int, str | None]] = []
        done = asyncio.Event()

        def committed() -> int:
            sequence = len(sequences) + 1
            sequences.append(sequence)
            return sequence

        def finalized(item_id: str, sequence: int, text: str | None) -> None:
            finals.append((item_id, sequence, text))
            if len(finals) == 2:
                done.set()

        transcriber, _ = make_source(
            monkeypatch,
            socket,
            on_delta=lambda item_id, sequence, text: deltas.append(
                (item_id, sequence, text)
            ),
            on_committed=committed,
            on_final=finalized,
        )
        await transcriber.send_audio(b"\x01\x00")

        socket.push({"type": "input_audio_buffer.committed", "item_id": "first"})
        socket.push({"type": "input_audio_buffer.committed", "item_id": "second"})
        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "first",
                "delta": "hel",
            }
        )
        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "second",
                "delta": "wor",
            }
        )
        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "first",
                "delta": "lo",
            }
        )
        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": "second",
                "delta": "ld",
            }
        )
        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "second",
                "transcript": "second result",
            }
        )
        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "second",
                "transcript": "duplicate",
            }
        )
        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "unknown",
                "transcript": "unmatched",
            }
        )
        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "first",
                "transcript": "first result",
            }
        )

        await asyncio.wait_for(done.wait(), timeout=0.1)
        await transcriber.close()

        assert sequences == [1, 2]
        assert deltas == [
            ("first", 1, "hel"),
            ("second", 2, "wor"),
            ("first", 1, "lo"),
            ("second", 2, "ld"),
        ]
        assert finals == [
            ("second", 2, "second result"),
            ("first", 1, "first result"),
        ]

    asyncio.run(run())


class ControlledSource:
    instances: ClassVar[dict[str, "ControlledSource"]] = {}

    def __init__(
        self,
        *,
        source: str,
        on_delta: Callable[[str, int, str], None],
        on_committed: Callable[[], int],
        on_final: Callable[[str, int, str | None], None],
        **_kwargs: object,
    ) -> None:
        self.audio: list[bytes] = []
        self.on_delta = on_delta
        self.on_committed = on_committed
        self.on_final = on_final
        self.sequence_by_item: dict[str, int] = {}
        self.close_calls = 0
        ControlledSource.instances[source] = self

    async def send_audio(self, pcm16: bytes) -> None:
        self.audio.append(pcm16)

    async def flush(self) -> None:
        return None

    async def close(self) -> None:
        self.close_calls += 1

    def commit(self, item_id: str) -> int:
        sequence = self.on_committed()
        self.sequence_by_item[item_id] = sequence
        return sequence

    def delta(self, item_id: str, text: str) -> None:
        self.on_delta(item_id, self.sequence_by_item[item_id], text)

    def finish(self, item_id: str, text: str | None) -> None:
        self.on_final(item_id, self.sequence_by_item[item_id], text)


def test_out_of_order_finals_are_persisted_and_published_in_commit_order(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def run() -> None:
        entry_id = create_entry(client)["id"]
        runtime = client.app.state.runtime
        events = runtime.transcript_events.subscribe(entry_id)
        ControlledSource.instances = {}
        monkeypatch.setattr(
            "meetwrite.features.transcription.session.SourceTranscriber",
            ControlledSource,
        )
        recording = RecordingSession(
            user_id=1,
            entry_id=entry_id,
            api_key="sk-test",
            model="gpt-live-transcribe",
            event_timeout_seconds=0.1,
            keywords=[],
            events=runtime.transcript_events,
            engine=runtime.engine,
        )

        await recording.send_audio("me", b"\x01\x00")
        source = ControlledSource.instances["me"]
        assert source.commit("first") == 1
        await recording.send_audio("me", b"\x01\x00")
        assert source.commit("second") == 2

        source.delta("first", "hel")
        source.delta("second", "wor")
        source.delta("first", "lo")
        source.delta("second", "ld")
        assert [events.get_nowait() for _ in range(4)] == [
            {
                "type": "delta",
                "source": "me",
                "item_id": "first",
                "sequence": 1,
                "delta": "hel",
                "_sequence": 1,
            },
            {
                "type": "delta",
                "source": "me",
                "item_id": "second",
                "sequence": 2,
                "delta": "wor",
                "_sequence": 2,
            },
            {
                "type": "delta",
                "source": "me",
                "item_id": "first",
                "sequence": 1,
                "delta": "lo",
                "_sequence": 1,
            },
            {
                "type": "delta",
                "source": "me",
                "item_id": "second",
                "sequence": 2,
                "delta": "ld",
                "_sequence": 2,
            },
        ]

        source.finish("second", "second result")
        with Session(runtime.engine) as session:
            assert list_lines(session, 1, entry_id) == []

        source.finish("first", "first result")
        with Session(runtime.engine) as session:
            lines = list_lines(session, 1, entry_id)
        assert [(line.sequence, line.source, line.text) for line in lines] == [
            (1, "me", "first result"),
            (2, "me", "second result"),
        ]
        final_events = [events.get_nowait() for _ in range(2)]
        assert [event["_sequence"] for event in final_events] == [1, 2]
        assert [event["item_id"] for event in final_events] == ["first", "second"]

        await recording.stop()
        assert source.close_calls == 1
        runtime.transcript_events.unsubscribe(entry_id, events)

    asyncio.run(run())


def test_flush_is_gated_by_both_commit_ack_and_matching_final(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        socket = FakeSocket()
        committed: list[int] = []
        finals: list[tuple[str, int, str | None]] = []

        def on_committed() -> int:
            committed.append(1)
            return 1

        transcriber, _ = make_source(
            monkeypatch,
            socket,
            on_committed=on_committed,
            on_final=lambda item_id, sequence, text: finals.append(
                (item_id, sequence, text)
            ),
        )
        await transcriber.send_audio(b"\x01\x00")

        flush = asyncio.create_task(transcriber.flush())
        await socket.commit_sent.wait()
        assert flush.done() is False

        socket.push({"type": "input_audio_buffer.committed", "item_id": "turn"})
        await spin_until(lambda: committed == [1])
        assert flush.done() is False

        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": "turn",
                "transcript": "last words",
            }
        )
        await flush
        await transcriber.flush()
        await transcriber.close()

        assert finals == [("turn", 1, "last words")]
        assert [frame["type"] for frame in socket.sent].count(
            "input_audio_buffer.commit"
        ) == 1

    asyncio.run(run())


def test_failed_provider_item_makes_finalization_fail_instead_of_losing_audio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        socket = FakeSocket()
        finals: list[tuple[str, int, str | None]] = []
        transcriber, _ = make_source(
            monkeypatch,
            socket,
            on_final=lambda item_id, sequence, text: finals.append(
                (item_id, sequence, text)
            ),
        )
        await transcriber.send_audio(b"\x01\x00")
        socket.push({"type": "input_audio_buffer.committed", "item_id": "turn"})
        socket.push(
            {
                "type": "conversation.item.input_audio_transcription.failed",
                "item_id": "turn",
                "error": {"message": "provider detail"},
            }
        )

        with pytest.raises(TranscriptionUnavailable, match="could not transcribe part"):
            await transcriber.flush()

        await transcriber.close()
        assert finals == []

    asyncio.run(run())


def test_a_clean_upstream_close_is_a_terminal_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        socket = FakeSocket()
        transcriber, _ = make_source(monkeypatch, socket)
        await transcriber.send_audio(b"\x01\x00")
        socket.events.put_nowait(None)
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        with pytest.raises(TranscriptionUnavailable, match="connection was lost"):
            await transcriber.flush()

        await transcriber.close()

    asyncio.run(run())


def test_flush_timeout_is_fast_and_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        socket = FakeSocket()
        transcriber, _ = make_source(monkeypatch, socket, timeout=0.0001)
        await transcriber.send_audio(b"\x01\x00")

        with pytest.raises(
            TranscriptionUnavailable, match="did not accept the audio turn in time"
        ):
            await transcriber.flush()

        await transcriber.close()

    asyncio.run(run())
