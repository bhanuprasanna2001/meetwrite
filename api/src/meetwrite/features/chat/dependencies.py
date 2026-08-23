"""FastAPI dependencies for user-owned chats."""

from typing import Annotated

from fastapi import Depends, HTTPException

from meetwrite.db.models import Chat
from meetwrite.db.session import DbSession
from meetwrite.features.chat.services import get_chat
from meetwrite.features.user.dependencies import LocalUser


def get_chat_or_404(chat_id: int, user: LocalUser, session: DbSession) -> Chat:
    assert user.id is not None
    chat = get_chat(session, user.id, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


CurrentChat = Annotated[Chat, Depends(get_chat_or_404)]
