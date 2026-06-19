import re
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


_SENTENCE_END = re.compile(r"[.!?…]+[\"')\]\}»”]*(?=\s|$)|\n+")


def _after_whitespace(text: str, pos: int) -> int:
    while pos < len(text) and text[pos].isspace():
        pos += 1
    return pos


def _boundary_positions(text: str, start: int, end: int) -> list[int]:
    boundaries = []
    end = min(len(text), end)
    for match in _SENTENCE_END.finditer(text, max(0, start), end):
        boundary = _after_whitespace(text, match.end())
        if boundary <= end:
            boundaries.append(boundary)
    return boundaries


def _nearest_chunk_end(text: str, start: int, target: int, min_end: int, max_end: int) -> int:
    boundaries = _boundary_positions(text, start, max_end)
    candidates = [pos for pos in boundaries if min_end <= pos <= max_end]
    if not candidates:
        return min(target, len(text))

    forward = [pos for pos in candidates if pos >= target]
    if forward:
        return forward[0]

    return candidates[-1]


def _nearest_chunk_start(text: str, previous_end: int, target: int, min_start: int) -> int:
    if target <= 0:
        return 0

    boundaries = [0, *_boundary_positions(text, min_start, previous_end)]
    candidates = [pos for pos in boundaries if min_start <= pos <= previous_end and pos <= target]
    if candidates:
        return candidates[-1]

    candidates = [pos for pos in boundaries if min_start <= pos <= previous_end and pos > target]
    if candidates:
        return candidates[0]

    return target


def _boundary_slop(chunk_size: int, overlap: int) -> int:
    if overlap > 0:
        return min(overlap, max(1, chunk_size // 4))
    return max(1, chunk_size // 10)


def _is_sentence_boundary(text: str, pos: int) -> bool:
    if pos <= 0 or pos >= len(text):
        return True
    previous = text[pos - 1]
    if previous.isspace():
        return True
    return previous in ".!?…\n\r"


def _next_sentence_end(text: str, min_pos: int, max_pos: int) -> int:
    for boundary in _boundary_positions(text, 0, max_pos):
        if boundary >= min_pos:
            return boundary
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
    pos = 0
    text_len = len(text)
    slop = _boundary_slop(chunk_size, overlap)

    while pos < text_len:
        remaining = text_len - pos
        if remaining <= chunk_size:
            end = text_len
        else:
            target = pos + chunk_size
            max_end = min(target + slop, text_len)
            min_end = pos + max(1, chunk_size - slop)
            end = _nearest_chunk_end(text, pos, target, min_end, max_end)

        raw = text[pos:end]
        slice_text = raw.strip()
        if slice_text:
            lead_ws = len(raw) - len(raw.lstrip())
            trail_ws = len(raw) - len(raw.rstrip())
            result.append(Chunk(
                order_id=order_id,
                text=slice_text,
                char_start=pos + lead_ws,
                char_end=end - trail_ws,
                char_count=len(slice_text),
                token_count=approximate_token_count(slice_text),
            ))
            order_id += 1

        if end >= text_len:
            break

        target_next = end - overlap
        min_next = max(pos + 1, target_next - slop)
        next_pos = _nearest_chunk_start(text, end, target_next, min_next)
        if next_pos <= pos:
            next_pos = pos + 1
        pos = next_pos

    return result


def reconstruct_text(chunks: list[Chunk]) -> str:
    if not chunks:
        return ""

    max_end = max(c.char_end for c in chunks)
    if max_end <= 0:
        return ""

    reconstructed = [""] * max_end
    for chunk in chunks:
        s = chunk.char_start
        if s < 0 or s >= len(reconstructed):
            continue
        e = chunk.char_end
        expected = s + len(chunk.text)
        if e > expected:
            e = expected
        if e > len(reconstructed):
            e = len(reconstructed)
        if e <= s:
            continue
        reconstructed[s:e] = list(chunk.text[: e - s])

    return "".join(reconstructed).rstrip("\x00")


def clip_snippet(text: str, max_len: int) -> str:
    text = text.strip()
    if max_len <= 0 or len(text) <= max_len:
        return text
    if max_len <= 3:
        return text[:max_len]
    return text[: max_len - 3] + "..."
