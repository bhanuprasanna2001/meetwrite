"""Alembic environment for meetwrite models."""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

import meetwrite.db.models  # noqa: F401  (registers every table)

config = context.config

if config.config_file_name is not None and config.attributes.get(
    "configure_logger", True
):
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata
database_url = str(
    config.attributes.get("database_url")
    or os.getenv("MEETWRITE_DATABASE_URL")
    or config.get_main_option("sqlalchemy.url")
)


def run_migrations_offline() -> None:
    """Emit SQL without connecting (for scripts and CI)."""

    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations through a live database connection."""

    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = database_url
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
