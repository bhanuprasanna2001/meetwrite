"""Endpoints for the current user's OpenAI API key."""

import logging
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, status

from meetwrite.core.ports import KeyStoreError
from meetwrite.core.runtime import RuntimeDep
from meetwrite.features.key import schemas
from meetwrite.features.user.dependencies import LocalUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/key", tags=["ai"])


def _keychain_or_500[T](action: Callable[[], T]) -> T:
    """Run a Keychain action; a broken Keychain is a 500, never a crash."""

    try:
        return action()
    except KeyStoreError as error:
        logger.error("key_store.unavailable", exc_info=error)
        raise HTTPException(status_code=500, detail="Keychain unavailable") from error


@router.get("/status", response_model=schemas.KeyStatus)
def read_key_status(user: LocalUser, runtime: RuntimeDep) -> schemas.KeyStatus:
    assert user.id is not None
    user_id = user.id
    return _keychain_or_500(
        lambda: schemas.KeyStatus(set=runtime.key_store.get(user_id) is not None)
    )


@router.put("", response_model=schemas.KeyStatus)
def put_key(
    payload: schemas.KeyUpdate, user: LocalUser, runtime: RuntimeDep
) -> schemas.KeyStatus:
    assert user.id is not None
    user_id = user.id
    _keychain_or_500(lambda: runtime.key_store.set(user_id, payload.key))
    logger.info("key.saved user_id=%s", user_id)
    return schemas.KeyStatus(set=True)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def remove_key(user: LocalUser, runtime: RuntimeDep) -> None:
    assert user.id is not None
    user_id = user.id
    _keychain_or_500(lambda: runtime.key_store.delete(user_id))
    logger.info("key.deleted user_id=%s", user_id)
