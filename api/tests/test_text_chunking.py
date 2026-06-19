from app.support.text import chunk_text, reconstruct_text


def test_chunk_text_uses_sentence_boundary_for_starts_and_ends() -> None:
    text = "Alpha ends. Beta ends. Gamma ends. Delta ends."

    chunks = chunk_text(text, chunk_size=22, overlap=11)

    assert len(chunks) > 1
    for chunk in chunks[:-1]:
        assert chunk.text[-1] in ".!?"
    for chunk in chunks[1:]:
        assert chunk.text.split()[0] in {"Beta", "Gamma", "Delta"}


def test_chunk_text_keeps_overshoot_bounded_when_sentence_boundary_is_near() -> None:
    text = "A" * 50 + ". Next sentence starts here. Final sentence."

    chunks = chunk_text(text, chunk_size=45, overlap=10)

    assert chunks[0].text.endswith(".")
    assert chunks[0].char_count <= 55


def test_chunk_text_falls_back_inside_long_sentence_when_boundary_is_too_far() -> None:
    text = "A" * 120 + ". Short tail."

    chunks = chunk_text(text, chunk_size=40, overlap=10)

    assert chunks[0].char_count == 40
    assert not chunks[0].text.endswith(".")


def test_chunk_text_preserves_configured_overlap_when_boundary_allows() -> None:
    text = "Alpha ends. Beta ends. Gamma ends. Delta ends."

    chunks = chunk_text(text, chunk_size=22, overlap=11)

    assert len(chunks) >= 2
    assert chunks[0].char_end - chunks[1].char_start >= 0
    assert chunks[1].text.startswith("Beta")


def test_reconstruct_text_handles_sentence_aware_overlap() -> None:
    text = "Alpha ends. Beta ends. Gamma ends. Delta ends."

    chunks = chunk_text(text, chunk_size=22, overlap=11)

    assert reconstruct_text(chunks) == text
