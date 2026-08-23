import json
from collections.abc import AsyncIterator
from pathlib import Path

from meetwrite.app import create_app
from meetwrite.core.config import AppConfig
from meetwrite.integrations.filesystem_audio import FileAudioStore


class SmokeKeyStore:
    def get(self, user_id: int) -> str | None:
        return "smoke-key"

    def set(self, user_id: int, value: str) -> None:
        pass

    def delete(self, user_id: int) -> None:
        pass


class SmokeAiProvider:
    def is_configured(self, user_id: int) -> bool:
        return True

    async def stream_chat(
        self, user_id: int, input_items: list[dict[str, str]]
    ) -> AsyncIterator[str]:
        yield "Smoke reply"

    async def enhance(
        self,
        user_id: int,
        *,
        instructions: str,
        source: str,
        schema: dict[str, object],
    ) -> str:
        return json.dumps({"title": "Smoke title", "notes": "Smoke notes"})


config = AppConfig()
app = create_app(
    config,
    key_store=SmokeKeyStore(),
    audio_store=FileAudioStore(Path(config.audio_dir)),
    ai_provider=SmokeAiProvider(),
)
