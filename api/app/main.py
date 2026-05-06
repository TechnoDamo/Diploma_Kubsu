import logging
import traceback

import structlog
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import Settings
from app.routers import analysis, documents, health, projects, rag
from app.support.logging import setup_logging

settings = Settings()
setup_logging(
    log_level=settings.log_level,
    log_format=settings.log_format,
    graylog_enabled=settings.graylog_enabled,
    graylog_host=settings.graylog_host,
    graylog_port=settings.graylog_port,
)

logger = structlog.get_logger(__name__)

app = FastAPI(
    title="Mimir RAG API",
    version="1.0.0",
    description="Интеллектуальная RAG-система с кросс-документным анализом противоречий",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    logger.info("request_start", method=request.method, path=request.url.path)
    response = await call_next(request)
    logger.info(
        "request_complete",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
    )
    return response


@app.middleware("http")
async def health_log_skip_middleware(request: Request, call_next):
    if request.url.path == "/healthz":
        return await call_next(request)
    return await call_next(request)


ERROR_MESSAGES: dict[str, str] = {
    "PROJECT_NOT_FOUND": "Проект не найден.",
    "PROJECT_ALREADY_EXISTS": "Проект с таким именем уже существует.",
    "PROJECT_REINDEXING": "Проект в процессе переиндексации, попробуйте позже.",
    "PROJECT_BUSY": "Проект занят, попробуйте позже.",
    "DOCUMENT_NOT_FOUND": "Документ не найден.",
    "DOCUMENT_BUSY": "Документ занят, попробуйте позже.",
    "DOCUMENT_NOT_READY": "Документ ещё не готов (обрабатывается или не проиндексирован).",
    "MISSING_UPLOAD_FILE": "Файл не был передан в запросе.",
    "FILE_TOO_LARGE": "Размер файла превышает максимально допустимый.",
    "ANALYSIS_JOB_NOT_FOUND": "Задача анализа не найдена.",
    "ANALYSIS_JOB_FAILED": "Задача анализа завершилась с ошибкой.",
    "INTERNAL_ERROR": "Внутренняя ошибка сервера.",
}


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    code = str(exc.detail) if exc.detail else f"HTTP_{exc.status_code}"
    message = ERROR_MESSAGES.get(code, str(exc.detail))
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": message}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    issues = [
        {"field": " -> ".join(str(loc) for loc in err["loc"]), "message": err["msg"]}
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {"code": "VALIDATION_ERROR", "message": "Ошибка валидации запроса."},
            "issues": issues,
        },
    )


@app.exception_handler(Exception)
async def json_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    logger.error(
        "unhandled_exception",
        method=request.method,
        path=request.url.path,
        error=f"{type(exc).__name__}: {exc}",
    )
    print(f"\n[ERROR] {request.method} {request.url.path}\n{tb}", flush=True)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": ERROR_MESSAGES["INTERNAL_ERROR"]}},
    )


app.include_router(health.router)
app.include_router(projects.router)
app.include_router(documents.router)
app.include_router(rag.router)
app.include_router(analysis.router)
