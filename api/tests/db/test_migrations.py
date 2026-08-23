from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from meetwrite.db.engine import create_db_engine
from meetwrite.db.migrations import migrate
from meetwrite.db.models import User


def test_fresh_migration_matches_the_application_models(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'migrated.db'}"
    migrate(database_url)
    engine = create_db_engine(database_url)

    expected_tables = {
        "chat",
        "dictionary_term",
        "enhanced_version",
        "entry",
        "entry_image",
        "entry_tag",
        "folder",
        "message",
        "preferences",
        "tag",
        "template",
        "transcript_line",
        "user",
    }
    assert (
        set(inspect(engine).get_table_names()) - {"alembic_version"} == expected_tables
    )

    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        assert compare_metadata(context, User.metadata) == []
        assert connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one() == ("0007_daily_note_time")

    engine.dispose()


def test_sqlite_driver_urls_enable_integrity_and_wal_pragmas(tmp_path: Path) -> None:
    engine = create_db_engine(f"sqlite+pysqlite:///{tmp_path / 'driver.db'}")

    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"

    engine.dispose()


def test_migration_accepts_database_paths_with_config_special_characters(
    tmp_path: Path,
) -> None:
    directory = tmp_path / "percent%folder"
    directory.mkdir()
    database_url = f"sqlite:///{directory / 'meetwrite.db'}"

    migrate(database_url)

    engine = create_db_engine(database_url)
    assert "user" in inspect(engine).get_table_names()
    engine.dispose()
