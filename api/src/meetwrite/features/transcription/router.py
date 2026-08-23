"""Live transcription transport and transcript reads."""

import asyncio
import base64
import binascii
import logging
from collections.abc import AsyncIterator
from contextlib import suppress

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlmodel import Session

from meetwrite.core.audio import validate_pcm16
from meetwrite.core.origins import TRUSTED_ORIGINS
from meetwrite.core.ports import KeyStoreError
from meetwrite.core.runtime import Runtime, RuntimeDep
from meetwrite.core.sse import sse_event
from meetwrite.db.session import DbSession
from meetwrite.features.entries.dependencies import CurrentEntry
from meetwrite.features.entries.services import get_entry
from meetwrite.features.settings.services import ensure_preferences
from meetwrite.features.transcription.schemas import (
    AudioFrame,
    StopFrame,
    TranscriptLineRead,
    TranscriptRead,
)
from meetwrite.features.transcription.services import (
    keyword_hints,
    line_payload,
    list_lines,
)
from meetwrite.features.transcription.session import (
    RecordingSession,
    TranscriptionUnavailable,
)
from meetwrite.features.user.services import ensure_local_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["transcription"])

CLOSE_NO_ENTRY = 4404
CLOSE_NO_KEY = 4401
CLOSE_ALREADY_RECORDING = 4409
CLOSE_AI_DISABLED = 4403
CLOSE_BAD_FRAME = 1008
CLOSE_TRANSCRIPTION_DOWN = 1011


async def _fail(websocket: WebSocket, message: str, code: int) -> None:
    with suppress(RuntimeError, WebSocketDisconnect):
        await websocket.send_json({"type": "error", "message": message})
    with suppress(RuntimeError, WebSocketDisconnect):
        await websocket.close(code=code)


def _parse_frame(value: object) -> AudioFrame | StopFrame:
    if isinstance(value, dict) and value.get("type") == "stop":
        return StopFrame.model_validate(value)
    return AudioFrame.model_validate(value)


@router.websocket("/entries/{entry_id}/transcribe")
async def transcribe(websocket: WebSocket, entry_id: int) -> None:
    await websocket.accept()
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in TRUSTED_ORIGINS:
        await _fail(websocket, "Origin is not allowed", CLOSE_BAD_FRAME)
        return

    runtime: Runtime = websocket.app.state.runtime
    with Session(runtime.engine) as session:
        user = ensure_local_user(session)
        assert user.id is not None
        entry = get_entry(session, user.id, entry_id)
        ai_enabled = ensure_preferences(session, user.id).ai_enabled
        # One immutable hint snapshot for the whole recording, captured
        # before any audio is accepted.
        keywords = keyword_hints(session, user.id, entry) if entry else []
    if entry is None:
        await _fail(websocket, "Entry not found", CLOSE_NO_ENTRY)
        return
    if not ai_enabled:
        logger.warning("ai.gate_rejected user_id=%s entry_id=%s", user.id, entry_id)
        await _fail(websocket, "AI features are turned off", CLOSE_AI_DISABLED)
        return

    try:
        api_key = runtime.key_store.get(user.id)
    except KeyStoreError:
        await _fail(websocket, "Keychain unavailable", CLOSE_TRANSCRIPTION_DOWN)
        return
    if api_key is None:
        await _fail(
            websocket,
            "Set your OpenAI API key in Settings first",
            CLOSE_NO_KEY,
        )
        return
    if not runtime.recordings.acquire(entry_id):
        await _fail(
            websocket,
            "This entry is already being recorded",
            CLOSE_ALREADY_RECORDING,
        )
        return

    recording = RecordingSession(
        user_id=user.id,
        entry_id=entry_id,
        api_key=api_key,
        model=runtime.config.transcribe_model,
        event_timeout_seconds=runtime.config.transcription_event_timeout_seconds,
        keywords=keywords,
        events=runtime.transcript_events,
        engine=runtime.engine,
    )
    stopped = False
    logger.info("recording.started entry_id=%s hint_count=%s", entry_id, len(keywords))
    try:
        while True:
            try:
                value = await websocket.receive_json()
                frame = _parse_frame(value)
            except WebSocketDisconnect:
                break
            except (ValidationError, ValueError, TypeError):
                await _fail(websocket, "Invalid recording frame", CLOSE_BAD_FRAME)
                return

            if isinstance(frame, StopFrame):
                try:
                    await recording.stop()
                except TranscriptionUnavailable as error:
                    await _fail(websocket, str(error), CLOSE_TRANSCRIPTION_DOWN)
                    return
                stopped = True
                await websocket.send_json({"type": "stopped"})
                break

            try:
                pcm16 = base64.b64decode(frame.audio, validate=True)
                validate_pcm16(pcm16)
            except (binascii.Error, ValueError):
                await _fail(
                    websocket, "audio must be base64-encoded PCM16", CLOSE_BAD_FRAME
                )
                return
            try:
                await recording.send_audio(frame.source, pcm16)
            except TranscriptionUnavailable as error:
                logger.warning(
                    "recording.failed entry_id=%s source=%s reason=%s",
                    entry_id,
                    frame.source,
                    error,
                )
                await _fail(websocket, str(error), CLOSE_TRANSCRIPTION_DOWN)
                return
    except WebSocketDisconnect:
        pass
    finally:
        if not stopped:
            with suppress(TranscriptionUnavailable):
                await recording.stop()
        runtime.recordings.release(entry_id)
        logger.info("recording.stopped entry_id=%s", entry_id)


@router.get("/entries/{entry_id}/transcript", response_model=TranscriptRead)
def read_transcript(entry: CurrentEntry, session: DbSession) -> TranscriptRead:
    assert entry.id is not None
    return TranscriptRead(
        lines=[
            TranscriptLineRead.model_validate(line)
            for line in list_lines(session, entry.user_id, entry.id)
        ]
    )


@router.get("/entries/{entry_id}/transcript/events", response_class=StreamingResponse)
def transcript_events(
    request: Request,
    entry: CurrentEntry,
    session: DbSession,
    runtime: RuntimeDep,
) -> StreamingResponse:
    assert entry.id is not None
    entry_id = entry.id
    queue = runtime.transcript_events.subscribe(entry_id)
    try:
        snapshot = list_lines(session, entry.user_id, entry_id)
    except Exception:
        runtime.transcript_events.unsubscribe(entry_id, queue)
        raise
    watermark = max((line.sequence for line in snapshot), default=0)

    async def stream() -> AsyncIterator[str]:
        try:
            yield sse_event(
                {"type": "resync", "lines": [line_payload(line) for line in snapshot]}
            )
            while not await request.is_disconnected():
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if item is None:
                    break
                event = item
                sequence = event.get("_sequence")
                if isinstance(sequence, int) and sequence <= watermark:
                    continue
                wire_event = {
                    key: value
                    for key, value in event.items()
                    if not key.startswith("_")
                }
                yield sse_event(wire_event)
        finally:
            runtime.transcript_events.unsubscribe(entry_id, queue)

    return StreamingResponse(stream(), media_type="text/event-stream")
