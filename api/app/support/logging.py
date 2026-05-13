import json
import logging
import socket
import sys
import traceback

import structlog


class GELFLogHandler(logging.Handler):
    """Sends GELF-formatted logs to Graylog via UDP."""

    def __init__(self, host: str, port: int = 12201,
                 facility: str = "mimir", level: int = logging.NOTSET):
        super().__init__(level)
        self._host = host
        self._port = port
        self._facility = facility
        self._localname = socket.gethostname()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level_map = {logging.CRITICAL: 2, logging.ERROR: 3, logging.WARNING: 4,
                         logging.INFO: 6, logging.DEBUG: 7}
            gelf = {
                "version": "1.1",
                "host": self._localname,
                "short_message": record.getMessage(),
                "timestamp": record.created,
                "level": level_map.get(record.levelno, 6),
                "_facility": self._facility,
                "_logger_name": record.name,
                "_level": record.levelname,
            }
            if record.exc_info and record.exc_info[0]:
                gelf["full_message"] = "".join(traceback.format_exception(*record.exc_info))

            payload = json.dumps(gelf, default=str).encode("utf-8")
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.sendto(payload, (self._host, self._port))
        except Exception:
            pass  # silently ignore Graylog delivery failures


def setup_logging(
    log_level: str = "INFO",
    log_format: str = "json",
    graylog_enabled: bool = False,
    graylog_host: str = "graylog",
    graylog_port: int = 12201,
) -> None:
    level = getattr(logging, log_level.upper(), logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    root_logger.handlers.clear()

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    root_logger.addHandler(console_handler)

    if graylog_enabled:
        graylog_handler = GELFLogHandler(
            host=graylog_host,
            port=graylog_port,
            facility="mimir",
            level=level,
        )
        root_logger.addHandler(graylog_handler)

    for noisy_logger in ("httpx", "httpcore", "fastembed", "huggingface_hub",
                         "urllib3", "qdrant_client", "asyncio"):
        logging.getLogger(noisy_logger).setLevel(logging.WARNING)

    _shared_processors = [
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]

    if log_format == "json":
        _shared_processors.append(structlog.processors.JSONRenderer())
    else:
        _shared_processors.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=_shared_processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
