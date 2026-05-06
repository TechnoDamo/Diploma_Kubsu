import asyncio
import logging

logger = logging.getLogger(__name__)


async def retry_call(
    coro_factory,
    max_retries: int = 3,
    delay: int = 5,
    name: str = "",
):
    last_exc = None
    for attempt in range(max_retries + 1):
        try:
            return await coro_factory()
        except Exception as e:
            last_exc = e
            if attempt == max_retries:
                break
            if not _is_retryable(e):
                raise
            wait = delay * (attempt + 1)
            logger.warning(
                "%s: retrying after error (attempt %d/%d, delay %ds): %s",
                name or "retry",
                attempt + 1,
                max_retries,
                wait,
                str(e),
            )
            await asyncio.sleep(wait)
    raise last_exc


def _is_retryable(exc: Exception) -> bool:
    try:
        import httpx
        if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, httpx.ConnectError, httpx.RemoteProtocolError)):
            return True
        if isinstance(exc, httpx.HTTPStatusError):
            return exc.response.status_code >= 500
    except ImportError:
        pass
    return True
