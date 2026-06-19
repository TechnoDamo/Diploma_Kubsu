import asyncio
import json
import logging

import httpx

logger = logging.getLogger(__name__)


class DoclingClient:
    def __init__(self, base_url: str, timeout: int = 3600):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def convert_file(self, filename: str, data: bytes, mime_type: str) -> str:
        if mime_type in ("text/plain", "text/markdown"):
            return data.decode("utf-8", errors="replace")

        if mime_type in ("application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"):
            return await self._convert_async(filename, data)

        return await self._convert_sync(filename, data)

    async def _convert_async(self, filename: str, data: bytes) -> str:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self._base_url}/v1/convert/file/async",
                files={"files": (filename, data)},
            )
            resp.raise_for_status()
            task_id = resp.json().get("task_id")
            if not task_id:
                raise RuntimeError(f"Docling: no task_id in response: {resp.text}")

        poll_url = f"{self._base_url}/v1/status/poll/{task_id}"
        deadline = asyncio.get_event_loop().time() + self._timeout

        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(2)
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(poll_url)
                if resp.status_code != 200:
                    continue
                body = resp.json()
                task_status = body.get("task_status", "")
                if task_status == "success":
                    result_url = f"{self._base_url}/v1/result/{task_id}"
                    result_resp = await client.get(result_url)
                    result_resp.raise_for_status()
                    return self._extract_text(result_resp.json())
                if task_status in ("failed", "error"):
                    raise RuntimeError(f"Docling conversion failed: {body}")

        raise TimeoutError("Docling async conversion timed out")

    async def _convert_sync(self, filename: str, data: bytes) -> str:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/v1/convert/file",
                files={"files": (filename, data)},
            )
            resp.raise_for_status()
            return self._extract_text(resp.json())

    def _extract_text(self, response: dict) -> str:
        if "document" in response and isinstance(response["document"], dict):
            doc = response["document"]
            for key in ("md_content", "text", "markdown", "text_content"):
                val = doc.get(key)
                if isinstance(val, str) and val:
                    return val

        text_keys = ["md_content", "text", "markdown", "body", "content"]
        stack = [response]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                for key in text_keys:
                    if key in node and isinstance(node[key], str):
                        return node[key]
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
        return json.dumps(response, ensure_ascii=False)
