"""Small interfaces for resources that differ between local and hosted apps."""

from collections.abc import AsyncIterator
from typing import Protocol


class KeyStore(Protocol):
    def get(self, user_id: int) -> str | None: ...

    def set(self, user_id: int, value: str) -> None: ...

    def delete(self, user_id: int) -> None: ...


class KeyStoreError(Exception):
    pass


class AudioStore(Protocol):
    def append(self, user_id: int, entry_id: int, pcm: bytes) -> None: ...

    def read(self, user_id: int, entry_id: int) -> bytes | None: ...

    def delete(self, user_id: int, entry_id: int) -> None: ...


class AiProviderError(Exception):
    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class AiProvider(Protocol):
    def is_configured(self, user_id: int) -> bool: ...

    def stream_chat(
        self, user_id: int, input_items: list[dict[str, str]]
    ) -> AsyncIterator[str]: ...

    async def enhance(
        self,
        user_id: int,
        *,
        instructions: str,
        source: str,
        schema: dict[str, object],
    ) -> str: ...

    async def suggest_title(self, user_id: int, *, source: str) -> str: ...
