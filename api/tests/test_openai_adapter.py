import asyncio
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any, ClassVar, Self

import httpx2
import pytest
from openai import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    RateLimitError,
)
from openai.types.responses import ResponseTextDeltaEvent

from meetwrite.core.config import AppConfig
from meetwrite.core.ports import AiProviderError, KeyStoreError
from meetwrite.integrations.openai import OpenAIProvider, _provider_error
from tests.conftest import FakeKeyStore


def text_delta(value: str, sequence: int) -> ResponseTextDeltaEvent:
    return ResponseTextDeltaEvent(
        content_index=0,
        delta=value,
        item_id="message",
        logprobs=[],
        output_index=0,
        sequence_number=sequence,
        type="response.output_text.delta",
    )


class FakeStream:
    def __init__(self, events: list[object], error: Exception | None) -> None:
        self.events = events
        self.error = error
        self.close_calls = 0

    async def __aiter__(self) -> AsyncIterator[object]:
        for event in self.events:
            yield event
        if self.error is not None:
            raise self.error

    async def close(self) -> None:
        self.close_calls += 1


class FakeResponses:
    def __init__(self, client: "FakeOpenAI") -> None:
        self.client = client

    async def create(self, **parameters: object) -> object:
        self.client.calls.append(parameters)
        if parameters.get("stream") is True:
            stream = FakeStream(
                FakeOpenAI.stream_events.copy(), FakeOpenAI.stream_error
            )
            self.client.stream = stream
            return stream
        return SimpleNamespace(output_text=FakeOpenAI.enhance_output)


class FakeOpenAI:
    instances: ClassVar[list["FakeOpenAI"]] = []
    stream_events: ClassVar[list[object]] = []
    stream_error: ClassVar[Exception | None] = None
    enhance_output: ClassVar[str] = '{"title":"Title","notes":"Notes"}'

    def __init__(self, **configuration: object) -> None:
        self.configuration = configuration
        self.calls: list[dict[str, object]] = []
        self.responses = FakeResponses(self)
        self.stream: FakeStream | None = None
        self.closed = False
        self.instances.append(self)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_args: object) -> None:
        self.closed = True


@pytest.fixture()
def provider(
    monkeypatch: pytest.MonkeyPatch, key_store: FakeKeyStore
) -> OpenAIProvider:
    FakeOpenAI.instances = []
    FakeOpenAI.stream_events = []
    FakeOpenAI.stream_error = None
    monkeypatch.setattr("meetwrite.integrations.openai.AsyncOpenAI", FakeOpenAI)
    key_store.set(7, "sk-user-seven")
    return OpenAIProvider(
        AppConfig(chat_model="gpt-contract", ai_timeout_seconds=3.5), key_store
    )


def test_chat_sends_the_private_responses_contract_and_filters_deltas(
    provider: OpenAIProvider,
) -> None:
    FakeOpenAI.stream_events = [
        object(),
        text_delta("first", 1),
        text_delta(" second", 2),
    ]
    input_items = [{"role": "user", "content": "Question"}]

    async def collect() -> list[str]:
        return [chunk async for chunk in provider.stream_chat(7, input_items)]

    chunks = asyncio.run(collect())

    assert chunks == ["first", " second"]
    [client] = FakeOpenAI.instances
    assert client.configuration == {
        "api_key": "sk-user-seven",
        "timeout": 3.5,
        "max_retries": 0,
    }
    assert client.calls == [
        {
            "model": "gpt-contract",
            "input": input_items,
            "store": False,
            "stream": True,
        }
    ]
    assert client.stream is not None and client.stream.close_calls == 1
    assert client.closed is True


def test_chat_maps_iterator_failures_and_closes_provider_resources(
    provider: OpenAIProvider,
) -> None:
    FakeOpenAI.stream_events = [text_delta("partial", 1)]
    FakeOpenAI.stream_error = ValueError("raw iterator failure")

    async def collect() -> list[str]:
        return [chunk async for chunk in provider.stream_chat(7, [])]

    with pytest.raises(AiProviderError, match="AI request failed"):
        asyncio.run(collect())

    [client] = FakeOpenAI.instances
    assert client.stream is not None and client.stream.close_calls == 1
    assert client.closed is True


def test_enhance_uses_strict_structured_output_without_provider_storage(
    provider: OpenAIProvider,
) -> None:
    schema: dict[str, Any] = {"type": "object", "additionalProperties": False}

    output = asyncio.run(
        provider.enhance(
            7,
            instructions="Grounded instructions",
            source="Meeting source",
            schema=schema,
        )
    )

    assert output == FakeOpenAI.enhance_output
    [client] = FakeOpenAI.instances
    assert client.calls == [
        {
            "model": "gpt-contract",
            "instructions": "Grounded instructions",
            "input": "Meeting source",
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "enhanced_notes",
                    "schema": schema,
                    "strict": True,
                }
            },
            "store": False,
        }
    ]
    assert client.closed is True


@pytest.mark.parametrize(
    ("error", "status", "message"),
    [
        (
            AuthenticationError(
                "raw authentication details",
                response=httpx2.Response(
                    401, request=httpx2.Request("POST", "https://api.openai.com")
                ),
                body=None,
            ),
            401,
            "Invalid OpenAI API key — update it in Settings",
        ),
        (
            RateLimitError(
                "raw rate-limit details",
                response=httpx2.Response(
                    429, request=httpx2.Request("POST", "https://api.openai.com")
                ),
                body=None,
            ),
            429,
            "OpenAI rate limit reached — try again in a moment",
        ),
        (
            APIConnectionError(
                request=httpx2.Request("POST", "https://api.openai.com")
            ),
            504,
            "OpenAI is unreachable — check your connection",
        ),
        (
            APIError(
                "raw provider details",
                httpx2.Request("POST", "https://api.openai.com"),
                body=None,
            ),
            502,
            "OpenAI request failed",
        ),
        (KeyStoreError("raw keychain details"), 500, "Keychain unavailable"),
        (ValueError("raw implementation details"), 502, "AI request failed"),
    ],
)
def test_provider_errors_are_mapped_without_leaking_raw_details(
    error: Exception, status: int, message: str
) -> None:
    mapped = _provider_error(error)

    assert mapped.status_code == status
    assert str(mapped) == message
    assert "raw" not in str(mapped)
