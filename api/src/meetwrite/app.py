"""Application composition and lifecycle."""

import logging
import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from meetwrite.core.config import AppConfig
from meetwrite.core.events import EventHub
from meetwrite.core.leases import LeaseRegistry
from meetwrite.core.logging import configure_logging
from meetwrite.core.origins import TRUSTED_ORIGINS
from meetwrite.core.ports import AiProvider, AudioStore, KeyStore
from meetwrite.core.runtime import Runtime
from meetwrite.db.engine import create_db_engine
from meetwrite.db.migrations import migrate
from meetwrite.features.settings.services import ensure_preferences
from meetwrite.features.templates.services import seed_builtin_templates
from meetwrite.features.user.services import ensure_local_user
from meetwrite.integrations.filesystem_audio import FileAudioStore
from meetwrite.integrations.keychain import KeyringKeyStore
from meetwrite.integrations.openai import OpenAIProvider
from meetwrite.router import api_router

logger = logging.getLogger(__name__)


def create_app(
    config: AppConfig | None = None,
    *,
    key_store: KeyStore | None = None,
    audio_store: AudioStore | None = None,
    ai_provider: AiProvider | None = None,
) -> FastAPI:
    config = config or AppConfig()
    configure_logging(config.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        migrate(config.database_url)
        engine = create_db_engine(config.database_url)
        keys = key_store or KeyringKeyStore()
        audio = audio_store or FileAudioStore(Path(config.audio_dir))
        ai = ai_provider or OpenAIProvider(config, keys)
        runtime = Runtime(
            config=config,
            engine=engine,
            key_store=keys,
            audio_store=audio,
            ai=ai,
            transcript_events=EventHub(),
            chat_turns=LeaseRegistry(),
            recordings=LeaseRegistry(),
        )
        app.state.runtime = runtime
        with Session(engine) as session:
            user = ensure_local_user(session)
            assert user.id is not None
            ensure_preferences(session, user.id)
            seed_builtin_templates(session, user.id)
            session.commit()
        logger.info("api.started")
        try:
            yield
        finally:
            engine.dispose()
            logger.info("api.stopped")

    app = FastAPI(
        title="meetwrite API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(TRUSTED_ORIGINS),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)

    @app.middleware("http")
    async def log_request(request: Request, call_next):
        started = time.perf_counter()
        request_id = uuid4().hex
        try:
            response = await call_next(request)
        except Exception as error:
            route = request.scope.get("route")
            logger.error(
                "http.failed request_id=%s method=%s route=%s error_type=%s",
                request_id,
                request.method,
                getattr(route, "path", "unmatched"),
                type(error).__name__,
            )
            raise
        route = request.scope.get("route")
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "http.completed request_id=%s method=%s route=%s status=%s duration_ms=%.1f",
            request_id,
            request.method,
            getattr(route, "path", "unmatched"),
            response.status_code,
            (time.perf_counter() - started) * 1000,
        )
        return response

    return app
