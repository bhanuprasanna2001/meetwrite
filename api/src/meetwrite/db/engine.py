"""Database engine construction."""

import logging

from sqlalchemy import Engine, event
from sqlalchemy.engine import make_url
from sqlmodel import create_engine

logger = logging.getLogger(__name__)


def create_db_engine(database_url: str) -> Engine:
    is_sqlite = make_url(database_url).get_backend_name() == "sqlite"
    engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False} if is_sqlite else {},
    )

    if is_sqlite:

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

    logger.debug("Database engine ready")
    return engine
