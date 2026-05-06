import hashlib
import os
import secrets
from datetime import date
from pathlib import Path
from typing import AsyncIterator, BinaryIO, Optional


class SavedFile:
    def __init__(self, relative_path: str, size_bytes: int, checksum: str):
        self.relative_path = relative_path
        self.size_bytes = size_bytes
        self.checksum = checksum


class FileStorage:
    def __init__(self, root_dir: str):
        self._root = Path(root_dir)

    def _store_path(self) -> Path:
        today = date.today()
        return self._root / str(today.year) / f"{today.month:02d}" / f"{today.day:02d}"

    async def save(self, filename: str, reader: BinaryIO) -> SavedFile:
        store_dir = self._store_path()
        store_dir.mkdir(parents=True, exist_ok=True)

        random_hex = secrets.token_hex(16)
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)
        relative_dir = str(store_dir.relative_to(self._root))
        relative = f"{relative_dir}/{random_hex}_{safe_name}"

        tmp_path = store_dir / f".{random_hex}.tmp"
        hasher = hashlib.sha256()
        size = 0
        with open(tmp_path, "wb") as f:
            while True:
                buf = reader.read(32768)
                if not buf:
                    break
                f.write(buf)
                hasher.update(buf)
                size += len(buf)

        final_path = store_dir / f"{random_hex}_{safe_name}"
        tmp_path.rename(final_path)

        return SavedFile(
            relative_path=str(relative),
            size_bytes=size,
            checksum=hasher.hexdigest(),
        )

    async def open(self, relative_path: str) -> BinaryIO:
        full_path = self._resolve(relative_path)
        return open(full_path, "rb")

    async def read_all(self, relative_path: str) -> bytes:
        full_path = self._resolve(relative_path)
        with open(full_path, "rb") as f:
            return f.read()

    async def delete(self, relative_path: str) -> None:
        full_path = self._resolve(relative_path)
        try:
            os.remove(full_path)
        except FileNotFoundError:
            pass

    async def delete_by_path(self, relative_path: str) -> None:
        await self.delete(relative_path)

    def _resolve(self, relative_path: str) -> Path:
        return (self._root / relative_path).resolve()

    async def ensure_dir(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)
