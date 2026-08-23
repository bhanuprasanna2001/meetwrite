import pytest
from fastapi.testclient import TestClient

from meetwrite.core.ports import KeyStoreError
from tests.conftest import FakeKeyStore, acting_as


def test_key_lifecycle_never_returns_the_secret(
    client: TestClient, key_store: FakeKeyStore
) -> None:
    secret = "sk-super-secret"
    assert client.get("/key/status").json() == {"set": False}

    saved = client.put("/key", json={"key": secret})

    assert saved.status_code == 200
    assert saved.json() == {"set": True}
    assert secret not in saved.text
    assert key_store.values == {1: secret}
    assert client.get("/key/status").json() == {"set": True}

    client.put("/key", json={"key": "sk-replacement"})
    assert key_store.values == {1: "sk-replacement"}
    assert client.delete("/key").status_code == 204
    assert client.delete("/key").status_code == 204
    assert client.get("/key/status").json() == {"set": False}


def test_keys_are_scoped_to_the_current_user(
    client: TestClient, key_store: FakeKeyStore
) -> None:
    client.put("/key", json={"key": "sk-local"})

    with acting_as(client, 2):
        assert client.get("/key/status").json() == {"set": False}
        client.put("/key", json={"key": "sk-other"})

    assert key_store.values == {1: "sk-local", 2: "sk-other"}
    assert client.get("/key/status").json() == {"set": True}


@pytest.mark.parametrize(
    ("operation", "method", "path", "body"),
    [
        ("get", "get", "/key/status", None),
        ("set", "put", "/key", {"key": "sk-secret"}),
        ("delete", "delete", "/key", None),
    ],
)
def test_key_store_failures_are_safe_and_do_not_leak_secrets(
    client: TestClient,
    key_store: FakeKeyStore,
    operation: str,
    method: str,
    path: str,
    body: dict[str, str] | None,
) -> None:
    key_store.failures[operation] = KeyStoreError("offline")

    response = client.request(method, path, json=body)

    assert response.status_code == 500
    assert response.json() == {"detail": "Keychain unavailable"}
    assert "sk-secret" not in response.text
