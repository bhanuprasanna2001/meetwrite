"""Per-user OpenAI keys stored in the operating-system keychain."""

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

from meetwrite.core.ports import KeyStoreError

SERVICE = "meetwrite"


class KeyringKeyStore:
    @staticmethod
    def _account(user_id: int) -> str:
        return f"openai:{user_id}"

    def get(self, user_id: int) -> str | None:
        try:
            value = keyring.get_password(SERVICE, self._account(user_id))
        except KeyringError as error:
            raise KeyStoreError("keychain read failed") from error
        return value or None

    def set(self, user_id: int, value: str) -> None:
        try:
            keyring.set_password(SERVICE, self._account(user_id), value)
        except KeyringError as error:
            raise KeyStoreError("keychain write failed") from error

    def delete(self, user_id: int) -> None:
        try:
            keyring.delete_password(SERVICE, self._account(user_id))
        except PasswordDeleteError:
            pass
        except KeyringError as error:
            raise KeyStoreError("keychain delete failed") from error
