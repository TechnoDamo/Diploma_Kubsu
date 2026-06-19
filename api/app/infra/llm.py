import json

import structlog
import httpx

from app.support.retry import retry_call

logger = structlog.get_logger(__name__)


class LLMClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: int = 180,
        max_retries: int = 3,
        retry_delay: int = 5,
    ):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_delay = retry_delay

    async def complete(self, system: str, user: str, json_mode: bool = False) -> str:
        log_kwargs = {
            "url": self._base_url,
            "model": self._model,
            "json_mode": json_mode,
        }
        if system:
            log_kwargs["system_prompt"] = system
        if user:
            log_kwargs["user_prompt"] = user
        logger.info("LLM request", **log_kwargs)
        async def _request():
            headers = {"Content-Type": "application/json"}
            if self._api_key:
                headers["Authorization"] = f"Bearer {self._api_key}"

            body = {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            }
            if json_mode:
                body["response_format"] = {"type": "json_object"}

            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    f"{self._base_url}/chat/completions",
                    headers=headers,
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                logger.info(
                    "LLM response",
                    url=self._base_url,
                    model=self._model,
                    content=content,
                )
                return content

        return await retry_call(
            _request,
            max_retries=self._max_retries,
            delay=self._retry_delay,
            name="LLM",
        )

    async def check_availability(self) -> bool:
        try:
            await self.complete("Reply with the single word OK.", "test")
            return True
        except Exception:
            return False
