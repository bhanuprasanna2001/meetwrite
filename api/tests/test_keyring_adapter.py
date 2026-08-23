import keyring
import pytest
from keyring.errors import KeyringError, PasswordDeleteError

from meetwrite.core.ports import KeyStoreError
from meetwrite.integrations.keychain import KeyringKeyStore


def test_keyring_uses_a_per_user_account_and_treats_empty_values_as_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, ...]] = []
    monkeypatch.setattr(
        keyring,
        "get_password",
        lambda service, account: calls.append(("get", service, account)) or "",
    )
    monkeypatch.setattr(
        keyring,
        "set_password",
        lambda service, account, value: calls.append(("set", service, account, value)),
    )
    monkeypatch.setattr(
        keyring,
        "delete_password",
        lambda service, account: calls.append(("delete", service, account)),
    )
    store = KeyringKeyStore()

    assert store.get(7) is None
    store.set(7, "sk-secret")
    store.delete(7)

    assert calls == [
        ("get", "meetwrite", "openai:7"),
        ("set", "meetwrite", "openai:7", "sk-secret"),
        ("delete", "meetwrite", "openai:7"),
    ]


def test_deleting_a_missing_key_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(_service: str, _account: str) -> None:
        raise PasswordDeleteError("missing")

    monkeypatch.setattr(keyring, "delete_password", missing)

    KeyringKeyStore().delete(1)


@pytest.mark.parametrize(
    "operation",
    ["get_password", "set_password", "delete_password"],
)
def test_keyring_backend_failures_are_translated(
    monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    def fail(*_args: object) -> None:
        raise KeyringError("raw backend failure")

    monkeypatch.setattr(keyring, operation, fail)
    store = KeyringKeyStore()

    with pytest.raises(KeyStoreError) as raised:
        if operation == "get_password":
            store.get(1)
        elif operation == "set_password":
            store.set(1, "sk-secret")
        else:
            store.delete(1)

    assert "raw backend failure" not in str(raised.value)
