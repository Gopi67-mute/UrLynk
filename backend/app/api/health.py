"""Health checks. They report status only: no versions, hosts, or error details."""

import logging
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import get_db, ping_database

logger = logging.getLogger("app.health")

router = APIRouter(prefix="/health", tags=["health"])


class HealthStatus(BaseModel):
    status: Literal["ok"]


class DatabaseHealthStatus(BaseModel):
    status: Literal["ok", "unavailable"]
    database: Literal["ok", "unavailable"]


@router.get("", response_model=HealthStatus)
def health() -> HealthStatus:
    """Liveness: the process is up and serving requests. Does not touch the database."""
    return HealthStatus(status="ok")


@router.get(
    "/db",
    response_model=DatabaseHealthStatus,
    responses={503: {"model": DatabaseHealthStatus}},
)
def database_health(db: Session = Depends(get_db)) -> DatabaseHealthStatus | JSONResponse:
    try:
        ping_database(db)
    except SQLAlchemyError as exc:
        logger.warning("Database health check failed: %s", type(exc).__name__)
        return JSONResponse(
            DatabaseHealthStatus(status="unavailable", database="unavailable").model_dump(),
            status_code=503,
        )
    return DatabaseHealthStatus(status="ok", database="ok")
