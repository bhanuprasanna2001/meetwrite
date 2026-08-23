"""FastAPI database session dependency."""

import logging
from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

logger = logging.getLogger(__name__)


def get_db_session(request: Request) -> Generator[Session]:
    """Provide a session that closes before any response body is streamed."""

    engine = request.app.state.runtime.engine

    with Session(engine) as session:
        try:
            yield session
        except HTTPException:
            raise
        except Exception as error:
            session.rollback()
            logger.error(
                "database.transaction_failed error_type=%s", type(error).__name__
            )
            raise


DbSession = Annotated[Session, Depends(get_db_session, scope="function")]
