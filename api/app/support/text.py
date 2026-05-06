from dataclasses import dataclass


@dataclass
class Chunk:
    order_id: int
    text: str
    char_start: int
    char_end: int
    char_count: int
    token_count: int


def approximate_token_count(text: str) -> int:
    return len(text.split())


def _last_preferred_break(window: str) -> int:
    for index in range(len(window) - 1, -1, -1):
        if window[index] in "\n .!?;,":
            return index
    return -1


def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 200) -> list[Chunk]:
    if chunk_size <= 0:
        chunk_size = 1200
    if overlap < 0:
        overlap = 0
    if overlap >= chunk_size:
        overlap = chunk_size // 4

    if not text.strip():
        return []

    result: list[Chunk] = []
    order_id = 0
    start = 0

    while start < len(text):
        end = start + chunk_size
        if end > len(text):
            end = len(text)
        else:
            window = text[start:end]
            cut = _last_preferred_break(window)
            if cut > chunk_size // 2:
                end = start + cut + 1

        chunk_text_slice = text[start:end]
        if chunk_text_slice.strip():
            result.append(
                Chunk(
                    order_id=order_id,
                    text=chunk_text_slice,
                    char_start=start,
                    char_end=end,
                    char_count=end - start,
                    token_count=approximate_token_count(chunk_text_slice),
                )
            )
            order_id += 1

        if end == len(text):
            break

        start = end - overlap
        if start < 0:
            start = 0
        if start >= end:
            start = end

    return result


def reconstruct_text(chunks: list[Chunk]) -> str:
    if not chunks:
        return ""

    max_end = max(c.char_end for c in chunks)
    if max_end <= 0:
        return ""

    reconstructed = [""] * max_end
    for chunk in chunks:
        start = chunk.char_start
        if start < 0 or start >= len(reconstructed):
            continue
        end = chunk.char_end
        expected = start + len(chunk.text)
        if end > expected:
            end = expected
        if end > len(reconstructed):
            end = len(reconstructed)
        if end <= start:
            continue
        reconstructed[start:end] = list(chunk.text[: end - start])

    return "".join(reconstructed).rstrip("\x00")


def clip_snippet(text: str, max_len: int) -> str:
    text = text.strip()
    if max_len <= 0 or len(text) <= max_len:
        return text
    if max_len <= 3:
        return text[:max_len]
    return text[: max_len - 3] + "..."
