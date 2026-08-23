"""One OpenAI Realtime transcription connection per labeled audio source."""

import asyncio
import base64
import json
import logging
from collections.abc import Callable
from contextlib import suppress
from functools import partial
from typing import Any
from uuid import uuid4

from sqlalchemy import Engine
from websockets.asyncio.client import ClientConnection
from websockets.asyncio.client import connect as websocket_connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from meetwrite.core.audio import SAMPLE_RATE_HZ, SAMPLE_WIDTH_BYTES
from meetwrite.core.events import EventHub
from meetwrite.features.transcription.services import (
    commit_line,
    line_payload,
    next_sequence,
)

logger = logging.getLogger(__name__)

SOURCES = frozenset({"me", "them"})
REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
# gpt-live-transcribe takes a candidate list of languages (not the singular
# "language" field). The list constrains language DETECTION; the model still
# writes what it hears, so strongly non-English audio can surface other
# scripts even with ["en"]. A hard English target exists only in the
# translation product (gpt-realtime-translate). The prompt below biases every
# word, name, and phrase toward English spelling.
TRANSCRIPTION_LANGUAGES = ["en"]
TRANSCRIPTION_PROMPT = (
    "The spoken language is English. Transcribe the speech verbatim in English "
    "using Latin characters only. Do not translate. Do not infer another "
    "language from accents, names, pronunciation, or unclear audio."
)
# "low" favours latency; "high" gives the model more audio context before
# emitting text, which improves word error rate. MeetWrite prefers accurate
# notes over instant captions.
TRANSCRIPTION_DELAY = "high"
COMMIT_INTERVAL_SECONDS = 6
COMMIT_INTERVAL_PCM_BYTES = int(
    SAMPLE_RATE_HZ * SAMPLE_WIDTH_BYTES * COMMIT_INTERVAL_SECONDS
)

OnDelta = Callable[[str, int, str], None]
OnCommitted = Callable[[], int]
OnFinal = Callable[[str, int, str | None], None]


class TranscriptionUnavailable(Exception):
    pass


def handshake_message(status_code: int) -> str:
    if status_code == 401:
        return "OpenAI rejected the API key (401) — check the key in Settings."
    if status_code == 403:
        return "OpenAI denied realtime transcription access (403)."
    if status_code == 429:
        return "OpenAI rate-limited transcription (429) — try again shortly."
    return f"OpenAI rejected the transcription connection ({status_code})."


def _error_message(event: dict[str, object]) -> str:
    error = event.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            return message
    return str(error or "OpenAI Realtime API error")


def _error_code(event: dict[str, object]) -> str:
    error = event.get("error")
    if isinstance(error, dict):
        return str(error.get("code") or "")
    return ""


def _error_event_id(event: dict[str, object]) -> str | None:
    error = event.get("error")
    if isinstance(error, dict):
        event_id = error.get("event_id")
        if isinstance(event_id, str):
            return event_id
    return None


def _is_empty_commit_error(event: dict[str, object]) -> bool:
    value = f"{_error_code(event)} {_error_message(event)}".lower()
    return "commit" in value and any(
        marker in value for marker in ("empty", "too short", "too small")
    )


class SourceTranscriber:
    def __init__(
        self,
        *,
        source: str,
        api_key: str,
        model: str,
        event_timeout_seconds: float,
        keywords: list[str],
        on_delta: OnDelta,
        on_committed: OnCommitted,
        on_final: OnFinal,
    ) -> None:
        self._source = source
        self._api_key = api_key
        self._model = model
        self._event_timeout_seconds = event_timeout_seconds
        self._keywords = keywords
        self._on_delta = on_delta
        self._on_committed = on_committed
        self._on_final = on_final
        self._socket: ClientConnection | None = None
        self._receiver: asyncio.Task[None] | None = None
        self._ready = asyncio.Event()
        self._commit_ack = asyncio.Event()
        self._finals_done = asyncio.Event()
        self._finals_done.set()
        self._sequence_by_item: dict[str, int] = {}
        self._pending_items: set[str] = set()
        self._audio_since_commit = False
        self._pcm_since_commit = 0
        self._commit_event_id: str | None = None
        self._failure: Exception | None = None
        self._closing = False

    async def send_audio(self, pcm16: bytes) -> None:
        self._raise_failure()
        socket = await self._ensure_connected()
        await self._wait_until_ready()
        try:
            await socket.send(
                json.dumps(
                    {
                        "type": "input_audio_buffer.append",
                        "audio": base64.b64encode(pcm16).decode("ascii"),
                    }
                )
            )
        except Exception as error:
            self._fail(error)
            raise TranscriptionUnavailable(
                "Transcription connection was lost — stop and try again."
            ) from error
        self._audio_since_commit = True
        self._pcm_since_commit += len(pcm16)
        if self._pcm_since_commit >= COMMIT_INTERVAL_PCM_BYTES:
            await self._commit()

    async def flush(self) -> None:
        self._raise_failure()
        if self._socket is None:
            return
        try:
            async with asyncio.timeout(self._event_timeout_seconds):
                await self._commit(wait_with_timeout=False)
                await self._finals_done.wait()
        except TimeoutError:
            if self._audio_since_commit:
                error = TranscriptionUnavailable(
                    "OpenAI did not accept the audio turn in time."
                )
                self._fail(error)
                raise error from None
            raise TranscriptionUnavailable(
                "The final transcript did not arrive in time — try stopping again."
            ) from None
        except TranscriptionUnavailable:
            raise
        except Exception as error:
            self._fail(error)
            raise TranscriptionUnavailable(
                "Transcription connection was lost while stopping."
            ) from error
        self._raise_failure()

    async def _commit(self, *, wait_with_timeout: bool = True) -> None:
        if not self._audio_since_commit:
            return
        socket = self._socket
        if socket is None:
            self._raise_failure()
            return
        self._commit_ack.clear()
        self._commit_event_id = uuid4().hex
        try:
            await socket.send(
                json.dumps(
                    {
                        "type": "input_audio_buffer.commit",
                        "event_id": self._commit_event_id,
                    }
                )
            )
            if wait_with_timeout:
                async with asyncio.timeout(self._event_timeout_seconds):
                    await self._commit_ack.wait()
            else:
                await self._commit_ack.wait()
        except TimeoutError:
            error = TranscriptionUnavailable(
                "OpenAI did not accept the audio turn in time."
            )
            self._fail(error)
            raise error from None
        except Exception as error:
            self._fail(error)
            raise TranscriptionUnavailable(
                "Transcription connection was lost while committing audio."
            ) from error
        finally:
            self._commit_event_id = None
        self._audio_since_commit = False
        self._pcm_since_commit = 0
        self._raise_failure()

    async def close(self) -> None:
        self._closing = True
        socket, self._socket = self._socket, None
        receiver, self._receiver = self._receiver, None
        if receiver is not None:
            receiver.cancel()
            with suppress(asyncio.CancelledError):
                await receiver
        if socket is not None:
            with suppress(ConnectionClosed):
                await socket.close()

    async def _ensure_connected(self) -> ClientConnection:
        if self._socket is not None:
            return self._socket
        try:
            socket = await websocket_connect(
                REALTIME_URL,
                additional_headers={"Authorization": f"Bearer {self._api_key}"},
                open_timeout=self._event_timeout_seconds,
            )
        except InvalidStatus as error:
            raise TranscriptionUnavailable(
                handshake_message(error.response.status_code)
            ) from error
        except Exception as error:
            raise TranscriptionUnavailable(
                "OpenAI transcription is unreachable — check your connection."
            ) from error

        self._socket = socket
        self._receiver = asyncio.create_task(self._receive(socket))
        try:
            await socket.send(json.dumps(self._session_update()))
        except Exception as error:
            await self.close()
            raise TranscriptionUnavailable(
                "OpenAI transcription setup failed — try again."
            ) from error
        logger.info(
            "transcription.source_open source=%s model=%s languages=%s delay=%s keywords=%s",
            self._source,
            self._model,
            TRANSCRIPTION_LANGUAGES,
            TRANSCRIPTION_DELAY,
            len(self._keywords),
        )
        return socket

    async def _wait_until_ready(self) -> None:
        try:
            async with asyncio.timeout(self._event_timeout_seconds):
                await self._ready.wait()
        except TimeoutError:
            error = TranscriptionUnavailable(
                "OpenAI did not accept the transcription session in time."
            )
            self._fail(error)
            raise error from None
        self._raise_failure()

    def _session_update(self) -> dict[str, object]:
        transcription: dict[str, object] = {
            "model": self._model,
            "delay": TRANSCRIPTION_DELAY,
            "languages": TRANSCRIPTION_LANGUAGES,
            "prompt": TRANSCRIPTION_PROMPT,
        }
        # Keywords bias recognition of names and jargon. They are hints, not
        # replacements — the provider never rewrites finished text with them.
        if self._keywords:
            transcription["keywords"] = self._keywords
        return {
            "type": "session.update",
            "session": {
                "type": "transcription",
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": SAMPLE_RATE_HZ},
                        "transcription": transcription,
                        "turn_detection": None,
                    }
                },
            },
        }

    async def _receive(self, socket: ClientConnection) -> None:
        try:
            async for raw_event in socket:
                event = json.loads(raw_event)
                if not isinstance(event, dict):
                    raise TypeError("provider event must be an object")
                self._handle_event(event)
        except asyncio.CancelledError:
            raise
        except ConnectionClosed as error:
            if not self._closing:
                self._fail(error)
        except Exception as error:  # noqa: BLE001
            self._fail(error)
        finally:
            if self._socket is socket:
                self._socket = None
            if not self._closing and self._failure is None:
                self._fail(ConnectionError("transcription socket closed"))

    def _handle_event(self, event: dict[str, object]) -> None:
        event_type = event.get("type")
        if event_type == "session.updated":
            self._ready.set()
            return
        if event_type == "input_audio_buffer.committed":
            item_id = event.get("item_id")
            if isinstance(item_id, str) and item_id not in self._sequence_by_item:
                sequence = self._on_committed()
                self._sequence_by_item[item_id] = sequence
                self._pending_items.add(item_id)
                self._finals_done.clear()
            self._commit_ack.set()
            return
        if event_type == "conversation.item.input_audio_transcription.delta":
            item_id = event.get("item_id")
            delta = event.get("delta")
            if isinstance(item_id, str) and isinstance(delta, str) and delta:
                delta_sequence = self._sequence_by_item.get(item_id)
                if delta_sequence is not None:
                    self._on_delta(item_id, delta_sequence, delta)
            return
        if event_type == "conversation.item.input_audio_transcription.failed":
            item_id = event.get("item_id")
            if isinstance(item_id, str) and item_id in self._sequence_by_item:
                self._sequence_by_item.pop(item_id)
                self._pending_items.discard(item_id)
                self._fail(
                    TranscriptionUnavailable(
                        "OpenAI could not transcribe part of the recording — "
                        "stop and try again."
                    )
                )
            return
        if event_type == "conversation.item.input_audio_transcription.completed":
            item_id = event.get("item_id")
            if not isinstance(item_id, str):
                return
            final_sequence = self._sequence_by_item.get(item_id)
            if final_sequence is None:
                return
            self._sequence_by_item.pop(item_id)
            transcript = event.get("transcript")
            text = (
                transcript
                if isinstance(transcript, str) and transcript.strip()
                else None
            )
            self._pending_items.discard(item_id)
            self._on_final(item_id, final_sequence, text)
            if not self._pending_items:
                self._finals_done.set()
            return
        if event_type == "error":
            if (
                self._commit_event_id is not None
                and _error_event_id(event) == self._commit_event_id
                and _is_empty_commit_error(event)
            ):
                self._commit_ack.set()
                return
            self._fail(TranscriptionUnavailable(_error_message(event)))

    def _fail(self, error: Exception) -> None:
        if self._failure is None:
            self._failure = error
        self._ready.set()
        self._commit_ack.set()
        self._finals_done.set()

    def _raise_failure(self) -> None:
        if self._failure is None:
            return
        if isinstance(self._failure, TranscriptionUnavailable):
            raise self._failure
        raise TranscriptionUnavailable(
            "Transcription connection was lost — stop and try again."
        ) from self._failure


class RecordingSession:
    def __init__(
        self,
        *,
        user_id: int,
        entry_id: int,
        api_key: str,
        model: str,
        event_timeout_seconds: float,
        keywords: list[str],
        events: EventHub[dict[str, Any]],
        engine: Engine,
    ) -> None:
        self._user_id = user_id
        self._entry_id = entry_id
        self._api_key = api_key
        self._model = model
        self._event_timeout_seconds = event_timeout_seconds
        self._keywords = keywords
        self._events = events
        self._engine = engine
        self._sources: dict[str, SourceTranscriber] = {}
        self._next_sequence = next_sequence(engine, entry_id)
        self._pending: set[int] = set()
        self._completed: dict[int, tuple[str, str, str | None]] = {}
        self._stop_task: asyncio.Task[None] | None = None

    async def send_audio(self, source: str, pcm16: bytes) -> None:
        if self._stop_task is not None:
            raise TranscriptionUnavailable("Recording is already stopping.")
        transcriber = self._sources.get(source)
        if transcriber is None:
            transcriber = SourceTranscriber(
                source=source,
                api_key=self._api_key,
                model=self._model,
                event_timeout_seconds=self._event_timeout_seconds,
                keywords=self._keywords,
                on_delta=partial(self._publish_delta, source),
                on_committed=partial(self._turn_committed, source),
                on_final=partial(self._turn_finished, source),
            )
            self._sources[source] = transcriber
        await transcriber.send_audio(pcm16)

    async def stop(self) -> None:
        if self._stop_task is None:
            self._stop_task = asyncio.create_task(self._stop())
        await asyncio.shield(self._stop_task)

    async def _stop(self) -> None:
        failure: BaseException | None = None
        try:
            results = await asyncio.gather(
                *(transcriber.flush() for transcriber in self._sources.values()),
                return_exceptions=True,
            )
            failure = next(
                (result for result in results if isinstance(result, BaseException)),
                None,
            )
        finally:
            await asyncio.gather(
                *(transcriber.close() for transcriber in self._sources.values()),
                return_exceptions=True,
            )
        if isinstance(failure, TranscriptionUnavailable):
            raise failure
        if failure is not None:
            raise TranscriptionUnavailable(
                "Transcription could not be finalized."
            ) from failure

    def _turn_committed(self, source: str) -> int:
        sequence = self._next_sequence
        self._next_sequence += 1
        self._pending.add(sequence)
        logger.debug(
            "transcription.turn_committed entry_id=%s source=%s sequence=%s",
            self._entry_id,
            source,
            sequence,
        )
        return sequence

    def _turn_finished(
        self, source: str, item_id: str, sequence: int, text: str | None
    ) -> None:
        self._completed[sequence] = (source, item_id, text)
        self._drain_completed()

    def _drain_completed(self) -> None:
        while self._pending:
            sequence = min(self._pending)
            result = self._completed.get(sequence)
            if result is None:
                return
            self._pending.remove(sequence)
            self._completed.pop(sequence)
            source, item_id, text = result
            if text is None:
                continue
            line, created = commit_line(
                self._engine,
                user_id=self._user_id,
                entry_id=self._entry_id,
                sequence=sequence,
                source=source,
                text=text,
            )
            if created:
                self._events.publish(
                    self._entry_id,
                    {
                        "type": "final",
                        "item_id": item_id,
                        "line": line_payload(line),
                        "_sequence": sequence,
                    },
                )

    def _publish_delta(
        self, source: str, item_id: str, sequence: int, text: str
    ) -> None:
        # `sequence` goes to the desktop so partials from overlapping turns
        # can be kept apart and ordered; `_sequence` stays server-side for
        # the snapshot-deduplication watermark in the events route.
        self._events.publish(
            self._entry_id,
            {
                "type": "delta",
                "source": source,
                "item_id": item_id,
                "sequence": sequence,
                "delta": text,
                "_sequence": sequence,
            },
        )
