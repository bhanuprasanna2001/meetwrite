"""Alembic startup migration runner."""

import sys
from pathlib import Path

from alembic import command
from alembic.config import Config


def project_files() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[3]


def migrate(database_url: str) -> None:
    root = project_files()
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    config.attributes["database_url"] = database_url
    config.attributes["configure_logger"] = False
    command.upgrade(config, "head")
