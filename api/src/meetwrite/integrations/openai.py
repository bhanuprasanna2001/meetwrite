"""OpenAI Responses API adapter used by chat and enhance."""

from collections.abc import AsyncIterator
from typing import ClassVar, cast

from openai import (
    APIConnectionError,
    APIError,
    AsyncOpenAI,
    AuthenticationError,
    RateLimitError,
)
from openai.types.responses import (
    ResponseInputParam,
    ResponseStreamEvent,
    ResponseTextDeltaEvent,
)

from meetwrite.core.config import AppConfig
from meetwrite.core.ports import AiProviderError, KeyStore, KeyStoreError


class OpenAIProvider:
    # A strict single-string schema for the title utility call.
    TITLE_SCHEMA: ClassVar[dict[str, object]] = {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "maxLength": 200,
                "description": "A short plain-text title for these notes, a few words.",
            },
        },
        "required": ["title"],
        "additionalProperties": False,
    }

    def __init__(self, config: AppConfig, key_store: KeyStore) -> None:
        self._config = config
        self._keys = key_store

    def is_configured(self, user_id: int) -> bool:
        return self._keys.get(user_id) is not None

    def _client(self, user_id: int) -> AsyncOpenAI:
        key = self._keys.get(user_id)
        if key is None:
            raise AiProviderError(
                "Set your OpenAI API key in Settings first", status_code=400
            )
        return AsyncOpenAI(
            api_key=key,
            timeout=self._config.ai_timeout_seconds,
            max_retries=0,
        )

    async def stream_chat(
        self, user_id: int, input_items: list[dict[str, str]]
    ) -> AsyncIterator[str]:
        try:
            async with self._client(user_id) as client:
                stream = await client.responses.create(
                    model=self._config.chat_model,
                    input=cast(ResponseInputParam, input_items),
                    store=False,
                    stream=True,
                )
                try:
                    async for event in cast(AsyncIterator[ResponseStreamEvent], stream):
                        if isinstance(event, ResponseTextDeltaEvent):
                            yield event.delta
                finally:
                    await stream.close()
        except AiProviderError:
            raise
        except Exception as error:
            raise _provider_error(error) from error

    async def enhance(
        self,
        user_id: int,
        *,
        instructions: str,
        source: str,
        schema: dict[str, object],
    ) -> str:
        try:
            async with self._client(user_id) as client:
                response = await client.responses.create(
                    model=self._config.chat_model,
                    instructions=instructions,
                    input=source,
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": "enhanced_notes",
                            "schema": schema,
                            "strict": True,
                        }
                    },
                    store=False,
                )
                return response.output_text
        except AiProviderError:
            raise
        except Exception as error:
            raise _provider_error(error) from error

    async def suggest_title(self, user_id: int, *, source: str) -> str:
        try:
            async with self._client(user_id) as client:
                response = await client.responses.create(
                    model=self._config.utility_model,
                    instructions=(
                        "Suggest a short factual title for the user's notes. "
                        "Use the notes' own words where possible; never invent "
                        "facts, names, owners, decisions, or action items. "
                        "3 to 8 words, plain text."
                    ),
                    input=source,
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": "suggested_title",
                            "schema": self.TITLE_SCHEMA,
                            "strict": True,
                        }
                    },
                    store=False,
                )
                return response.output_text
        except AiProviderError:
            raise
        except Exception as error:
            raise _provider_error(error) from error


def _provider_error(error: Exception) -> AiProviderError:
    if isinstance(error, KeyStoreError):
        return AiProviderError("Keychain unavailable", status_code=500)
    if isinstance(error, AuthenticationError):
        return AiProviderError(
            "Invalid OpenAI API key — update it in Settings", status_code=401
        )
    if isinstance(error, RateLimitError):
        return AiProviderError(
            "OpenAI rate limit reached — try again in a moment", status_code=429
        )
    if isinstance(error, APIConnectionError):
        return AiProviderError(
            "OpenAI is unreachable — check your connection", status_code=504
        )
    if isinstance(error, APIError):
        return AiProviderError("OpenAI request failed")
    return AiProviderError("AI request failed")
