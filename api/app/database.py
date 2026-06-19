from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import Settings


class Base(DeclarativeBase):
    pass


def create_engine(settings: Settings):
    dsn = settings.postgres_dsn.replace("postgres://", "postgresql+asyncpg://", 1)
    return create_async_engine(
        dsn,
        pool_size=settings.postgres_max_conns,
        pool_pre_ping=True,
    )


def create_session_factory(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
