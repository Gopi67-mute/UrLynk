"""Logging setup. Log lines carry request IDs, never tokens, credentials or query strings."""

import logging
import sys

_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def configure_logging(level: str) -> None:
    root = logging.getLogger()
    if not any(getattr(handler, "_urlynk", False) for handler in root.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(_FORMAT))
        handler._urlynk = True  # type: ignore[attr-defined]
        root.addHandler(handler)
    root.setLevel(level)
    # Uvicorn's access log prints full URLs, including query strings; ours omits them.
    logging.getLogger("uvicorn.access").disabled = True
