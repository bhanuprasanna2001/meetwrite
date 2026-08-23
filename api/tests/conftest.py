from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from meetwrite.app import create_app
from meetwrite.core.config import AppConfig
from meetwrite.core.ports import AiProviderError
from meetwrite.db.models import User
from meetwrite.features.user.dependencies import get_local_user
from meetwrite.integrations.filesystem_audio import FileAudioStore


@dataclass
class FakeKeyStore:
    values: dict[int, str] = field(default_factory=dict)
    failures: dict[str, Exception] = field(default_factory=dict)

    def _raise_failure(self, operation: str) -> None:
        if error := self.failures.get(operation):
            raise error

    def get(self, user_id: int) -> str | None:
        self._raise_failure("get")
        return self.values.get(user_id)

    def set(self, user_id: int, value: str) -> None:
        self._raise_failure("set")
        self.values[user_id] = value

    def delete(self, user_id: int) -> None:
        self._raise_failure("delete")
        self.values.pop(user_id, None)


@dataclass
class ScriptedAiProvider:
    key_store: FakeKeyStore
    chat_chunks: list[str] = field(default_factory=lambda: ["Hello", " there"])
    chat_error: AiProviderError | None = None
    structured_outputs: list[str | Exception] = field(default_factory=list)
    chat_calls: list[tuple[int, list[dict[str, str]]]] = field(default_factory=list)
    enhance_calls: list[dict[str, object]] = field(default_factory=list)
    title_outputs: list[str | Exception] = field(default_factory=list)
    title_calls: list[tuple[int, str]] = field(default_factory=list)

    def is_configured(self, user_id: int) -> bool:
        return self.key_store.get(user_id) is not None

    async def stream_chat(
        self, user_id: int, input_items: list[dict[str, str]]
    ) -> AsyncIterator[str]:
        self.chat_calls.append((user_id, input_items))
        for chunk in self.chat_chunks:
            yield chunk
        if self.chat_error is not None:
            raise self.chat_error

    async def enhance(
        self,
        user_id: int,
        *,
        instructions: str,
        source: str,
        schema: dict[str, object],
    ) -> str:
        self.enhance_calls.append(
            {
                "user_id": user_id,
                "instructions": instructions,
                "source": source,
                "schema": schema,
            }
        )
        if self.structured_outputs:
            result = self.structured_outputs.pop(0)
            if isinstance(result, Exception):
                raise result
            return result
        return json.dumps(
            {
                "title": "Launch plan",
                "notes": "Launch\n\n• Ship on Tuesday",
            }
        )

    async def suggest_title(self, user_id: int, *, source: str) -> str:
        self.title_calls.append((user_id, source))
        if self.title_outputs:
            result = self.title_outputs.pop(0)
            if isinstance(result, Exception):
                raise result
            return result
        return json.dumps({"title": "Suggested title"})


@pytest.fixture()
def app_config(tmp_path: Path) -> AppConfig:
    return AppConfig(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        audio_dir=str(tmp_path / "audio"),
        log_level="CRITICAL",
        ai_timeout_seconds=0.1,
        transcription_event_timeout_seconds=0.1,
    )


@pytest.fixture()
def key_store() -> FakeKeyStore:
    return FakeKeyStore()


@pytest.fixture()
def audio_store(tmp_path: Path) -> FileAudioStore:
    return FileAudioStore(tmp_path / "audio")


@pytest.fixture()
def ai_provider(key_store: FakeKeyStore) -> ScriptedAiProvider:
    return ScriptedAiProvider(key_store)


@pytest.fixture()
def client(
    app_config: AppConfig,
    key_store: FakeKeyStore,
    audio_store: FileAudioStore,
    ai_provider: ScriptedAiProvider,
) -> Iterator[TestClient]:
    app = create_app(
        app_config,
        key_store=key_store,
        audio_store=audio_store,
        ai_provider=ai_provider,
    )
    with TestClient(app) as test_client:
        yield test_client


def create_entry(client: TestClient, **changes: str | None) -> dict:
    entry = client.post("/entries").json()
    if changes:
        response = client.patch(f"/entries/{entry['id']}", json=changes)
        assert response.status_code == 200
        return response.json()
    return entry


@contextmanager
def acting_as(
    client: TestClient, user_id: int, name: str = "Other user"
) -> Iterator[None]:
    with Session(client.app.state.runtime.engine) as session:
        user = session.get(User, user_id)
        if user is None:
            session.add(User(id=user_id, name=name))
            session.commit()

    dependency_overrides = client.app.dependency_overrides
    previous = dependency_overrides.get(get_local_user)
    dependency_overrides[get_local_user] = lambda: User(id=user_id, name=name)
    try:
        yield
    finally:
        if previous is None:
            dependency_overrides.pop(get_local_user, None)
        else:
            dependency_overrides[get_local_user] = previous
