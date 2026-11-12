from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context
from app import models  # noqa: F401  (registers every model on Base.metadata)
from app.core.config import Settings
from app.db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    # Tests (and tooling) may pass a URL explicitly; otherwise use validated app settings.
    override = config.attributes.get("database_url")
    if override:
        return override
    return Settings().database_url.get_secret_value()  # type: ignore[call-arg]


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(_database_url(), poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
