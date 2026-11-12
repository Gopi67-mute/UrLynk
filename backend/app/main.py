"""FastAPI application factory and ASGI entry point (`uvicorn app.main:app`)."""

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api import health
from app.api.v1 import api_router
from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.security import ClerkTokenVerifier, JwksCache, http_jwks_fetcher
from app.db.session import create_db_engine, create_session_factory

logger = logging.getLogger("app")


def create_app(
    settings: Settings | None = None,
    *,
    token_verifier: ClerkTokenVerifier | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_db_engine(settings)
        app.state.engine = engine
        app.state.session_factory = create_session_factory(engine)
        app.state.token_verifier = token_verifier or ClerkTokenVerifier(
            JwksCache(
                http_jwks_fetcher(settings.resolved_jwks_url, settings.jwks_fetch_timeout_seconds),
                ttl_seconds=settings.jwks_cache_ttl_seconds,
                min_refresh_interval_seconds=settings.jwks_min_refresh_interval_seconds,
            ),
            issuer=settings.clerk_issuer,
            authorized_parties=settings.clerk_authorized_parties,
            leeway_seconds=settings.jwt_leeway_seconds,
        )
        logger.info("UrLynk API started (env=%s)", settings.app_env)
        try:
            yield
        finally:
            engine.dispose()
            logger.info("UrLynk API stopped; database connections closed")

    app = FastAPI(
        title="UrLynk API",
        version="0.1.0",
        lifespan=lifespan,
        # Interactive docs help locally; production does not advertise its API surface.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.state.settings = settings

    register_exception_handlers(app)

    if settings.cors_origins:
        # The Android app is not a browser and needs no CORS; this is for web clients only.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,  # Bearer tokens, not cookies.
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
            expose_headers=["X-Request-ID"],
            max_age=600,
        )

    request_logger = logging.getLogger("app.request")

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Request-ID"] = request_id
        # Path only: query strings can carry search terms and other personal data.
        request_logger.info(
            "%s %s -> %d in %.1fms (request_id=%s)",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
        return response

    app.include_router(health.router)
    app.include_router(api_router)
    return app


app = create_app()
