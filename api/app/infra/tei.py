import logging

import httpx

from app.support.retry import retry_call

logger = logging.getLogger(__name__)


class TEIClient:
    def __init__(
        self,
        base_url: str,
        timeout: int = 180,
        api_key: str = "",
        model: str = "",
        api_type: str = "tei",
        max_retries: int = 3,
        retry_delay: int = 5,
    ):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._api_key = api_key
        self._model = model
        self._api_type = api_type
        self._max_retries = max_retries
        self._retry_delay = retry_delay

    async def embed(self, texts: list[str], dimension: int) -> list[list[float]]:
        if self._api_type == "openai_compatible":
            return await self._embed_openai(texts, dimension)
        return await self._embed_tei(texts, dimension)

    async def _embed_openai(self, texts: list[str], dimension: int) -> list[list[float]]:
        async def _request():
            headers = {"Content-Type": "application/json"}
            if self._api_key:
                headers["Authorization"] = f"Bearer {self._api_key}"
            payload = {"input": texts, "model": self._model}
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    f"{self._base_url}/embeddings",
                    headers=headers,
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
                return [d["embedding"] for d in data["data"]]
        return await retry_call(_request, max_retries=self._max_retries, delay=self._retry_delay, name="Embedding")

    async def _embed_tei(self, texts: list[str], dimension: int) -> list[list[float]]:
        async def _request():
            payload = {"inputs": texts, "dimensions": dimension}
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(f"{self._base_url}/embed", json=payload)
                resp.raise_for_status()
                return self._decode_embeddings(resp.json(), len(texts))
        return await retry_call(_request, max_retries=self._max_retries, delay=self._retry_delay, name="Embedding")

    async def check_availability(self) -> bool:
        try:
            if self._api_type == "openai_compatible":
                result = await self._embed_openai(["healthcheck"], 384)
            else:
                result = await self._embed_tei(["healthcheck"], 384)
            return len(result) == 1
        except Exception:
            return False

    def _decode_embeddings(self, data, expected: int) -> list[list[float]]:
        if isinstance(data, list):
            if data and isinstance(data[0], list):
                return data
            if data and isinstance(data[0], dict):
                if "embedding" in data[0]:
                    return [d["embedding"] for d in data]
                if "embeddings" in data[0]:
                    return data[0]["embeddings"]
                if "data" in data[0]:
                    return [d["data"] for d in data]
        if isinstance(data, dict):
            if "embeddings" in data:
                return data["embeddings"]
            if "embedding" in data:
                return data["embedding"]
            if "data" in data:
                return [d["embedding"] for d in data["data"]]
        return data
