"""Chat endpoints."""

import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from meetwrite.core.ports import AiProviderError, KeyStoreError
from meetwrite.core.runtime import RuntimeDep
from meetwrite.core.sse import sse_event
from meetwrite.db.models import Chat
from meetwrite.db.session import DbSession
from meetwrite.features.chat import schemas
from meetwrite.features.chat.dependencies import CurrentChat
from meetwrite.features.chat.services import (
    ChatUnavailable,
    build_input,
    create_chat,
    delete_chat,
    get_chat,
    list_chats,
    list_messages,
    rename_chat,
    save_turn,
)
from meetwrite.features.entries.dependencies import CurrentEntry
from meetwrite.features.entries.services import get_entry
from meetwrite.features.settings.dependencies import AiEnabled
from meetwrite.features.user.dependencies import LocalUser

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chats"])


@router.post(
    "/entries/{entry_id}/chats",
    response_model=schemas.ChatRead,
    status_code=status.HTTP_201_CREATED,
)
def start_chat(entry: CurrentEntry, user: LocalUser, session: DbSession) -> Chat:
    assert entry.id is not None and user.id is not None
    return create_chat(session, user.id, entry.id)


@router.get("/entries/{entry_id}/chats", response_model=list[schemas.ChatRead])
def read_chats(entry: CurrentEntry, user: LocalUser, session: DbSession) -> list[Chat]:
    assert entry.id is not None and user.id is not None
    return list_chats(session, user.id, entry.id)


@router.get("/chats/{chat_id}/messages", response_model=list[schemas.MessageRead])
def read_messages(
    chat: CurrentChat, user: LocalUser, session: DbSession
) -> list[schemas.MessageRead]:
    assert chat.id is not None and user.id is not None
    return [
        schemas.MessageRead.model_validate(message)
        for message in list_messages(session, user.id, chat.id)
    ]


@router.post("/chats/{chat_id}/messages", response_class=StreamingResponse)
async def send_message(
    payload: schemas.MessageCreate,
    chat: CurrentChat,
    user: LocalUser,
    ai: AiEnabled,
    runtime: RuntimeDep,
) -> StreamingResponse:
    assert chat.id is not None and user.id is not None
    chat_id, user_id = chat.id, user.id

    try:
        configured = runtime.ai.is_configured(user_id)
    except KeyStoreError as error:
        raise HTTPException(status_code=500, detail="Keychain unavailable") from error
    if not configured:
        raise HTTPException(
            status_code=400, detail="Set your OpenAI API key in Settings first"
        )

    lease = (user_id, chat_id)
    if not runtime.chat_turns.acquire(lease):
        raise HTTPException(
            status_code=409, detail="A reply is already in progress for this chat"
        )

    async def reply_events() -> AsyncIterator[str]:
        provider_stream: AsyncIterator[str] | None = None
        try:
            with Session(runtime.engine) as read_session:
                active_chat = get_chat(read_session, user_id, chat_id)
                if active_chat is None:
                    raise ChatUnavailable
                entry = get_entry(read_session, user_id, active_chat.entry_id)
                if entry is None:
                    raise ChatUnavailable
                history = list_messages(read_session, user_id, chat_id)
                input_items = build_input(
                    read_session,
                    entry,
                    history,
                    payload.content,
                    runtime.config.chat_context_characters,
                )
                title_first_chat = not history

            chunks: list[str] = []
            provider_stream = runtime.ai.stream_chat(user_id, input_items)
            async for delta in provider_stream:
                chunks.append(delta)
                yield sse_event({"delta": delta})

            reply = "".join(chunks)
            if not reply:
                raise AiProviderError("OpenAI returned an empty reply")

            with Session(runtime.engine) as write_session:
                active_chat = get_chat(write_session, user_id, chat_id)
                if active_chat is None:
                    raise ChatUnavailable
                message = save_turn(
                    write_session,
                    active_chat,
                    payload.content,
                    reply,
                    title_first_chat=title_first_chat,
                )
                message_payload = schemas.MessageRead.model_validate(
                    message
                ).model_dump(mode="json")
            yield sse_event({"message": message_payload})
        except AiProviderError as error:
            logger.warning(
                "chat.turn_failed user_id=%s chat_id=%s status=%s",
                user_id,
                chat_id,
                error.status_code,
            )
            yield sse_event({"error": str(error)})
        except ChatUnavailable:
            yield sse_event({"error": "Chat is no longer available"})
        except SQLAlchemyError as error:
            logger.error(
                "chat.persistence_failed user_id=%s chat_id=%s error_type=%s",
                user_id,
                chat_id,
                type(error).__name__,
            )
            yield sse_event({"error": "Reply could not be saved"})
        finally:
            try:
                if provider_stream is not None:
                    close = getattr(provider_stream, "aclose", None)
                    if close is not None:
                        await close()
            except Exception:
                logger.warning(
                    "chat.provider_close_failed user_id=%s chat_id=%s",
                    user_id,
                    chat_id,
                    exc_info=True,
                )
            finally:
                runtime.chat_turns.release(lease)

    return StreamingResponse(reply_events(), media_type="text/event-stream")


@router.delete("/chats/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_chat(chat: CurrentChat, session: DbSession) -> None:
    delete_chat(session, chat)


@router.patch("/chats/{chat_id}", response_model=schemas.ChatRead)
def patch_chat(
    payload: schemas.ChatUpdate, chat: CurrentChat, session: DbSession
) -> Chat:
    return rename_chat(session, chat, payload.title)
