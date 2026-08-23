"""Resources constructed once at application startup."""

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy import Engine

from meetwrite.core.config import AppConfig
from meetwrite.core.events import EventHub
from meetwrite.core.leases import LeaseRegistry
from meetwrite.core.ports import AiProvider, AudioStore, KeyStore


@dataclass(frozen=True)
class Runtime:
    config: AppConfig
    engine: Engine
    key_store: KeyStore
    audio_store: AudioStore
    ai: AiProvider
    transcript_events: EventHub[dict[str, Any]]
    chat_turns: LeaseRegistry
    recordings: LeaseRegistry


def get_runtime(request: Request) -> Runtime:
    return request.app.state.runtime


RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
