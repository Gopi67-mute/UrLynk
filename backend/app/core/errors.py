"""One error shape for every failure: {"error": {"code", "message", "request_id", "details"?}}."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app.errors")


class ApiError(Exception):
    """An expected failure with a stable, client-safe code and message.

    `details` carries structured facts the client needs to say something specific —
    which member is blocking an operation, for instance — so an app can compose its own
    sentence instead of either showing a generic message or displaying server text
    verbatim. Only put client-safe values in it: it is sent to the caller as-is.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers
        self.details = details


_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    429: "too_many_requests",
}


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    *,
    details: Any = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "code": code,
        "message": message,
        "request_id": _request_id(request),
    }
    if details is not None:
        body["details"] = details
    return JSONResponse({"error": body}, status_code=status_code, headers=headers)


async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
    return error_response(
        request,
        exc.status_code,
        exc.code,
        exc.message,
        details=exc.details,
        headers=exc.headers,
    )


async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = _STATUS_CODES.get(exc.status_code, "http_error")
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return error_response(request, exc.status_code, code, message, headers=exc.headers)


async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Submitted values are left out so they are never echoed back or logged.
    details = [
        {"loc": list(error.get("loc", ())), "msg": error.get("msg"), "type": error.get("type")}
        for error in exc.errors()
    ]
    return error_response(
        request, 422, "validation_error", "The request is invalid.", details=details
    )


async def _database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Database unavailable (request_id=%s): %s", _request_id(request), type(exc).__name__
    )
    return error_response(
        request, 503, "service_unavailable", "The service is temporarily unavailable."
    )


async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error (request_id=%s)", _request_id(request))
    return error_response(request, 500, "internal_error", "An unexpected error occurred.")


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    # Connection failures (database down, unreachable, timed out) are 503, not 500.
    app.add_exception_handler(OperationalError, _database_unavailable)
    app.add_exception_handler(Exception, _unhandled)
