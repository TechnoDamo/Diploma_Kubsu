package support

import "testing"

func TestChunkTextPreservesOrderAndOverlap(t *testing.T) {
	input := "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj"

	chunks := ChunkText(input, 16, 4)
	if len(chunks) < 2 {
		t.Fatalf("expected multiple chunks, got %d", len(chunks))
	}

	for index, chunk := range chunks {
		if chunk.OrderID != index {
			t.Fatalf("expected chunk order %d, got %d", index, chunk.OrderID)
		}
		if chunk.CharEnd < chunk.CharStart {
			t.Fatalf("invalid chunk offsets: start=%d end=%d", chunk.CharStart, chunk.CharEnd)
		}
		if chunk.TokenCount <= 0 {
			t.Fatalf("expected positive token count for chunk %d", index)
		}
	}
}

func TestChunkTextAndReconstructPreserveUnicodeAndWhitespace(t *testing.T) {
	input := "  Привет мир.\nВторая строка с отступом.\n"

	chunks := ChunkText(input, 10, 3)
	if len(chunks) < 2 {
		t.Fatalf("expected multiple chunks, got %d", len(chunks))
	}

	for _, chunk := range chunks {
		if chunk.CharCount != chunk.CharEnd-chunk.CharStart {
			t.Fatalf("unexpected char count for chunk %+v", chunk)
		}
	}

	reconstructed := ReconstructText(chunks)
	if reconstructed != input {
		t.Fatalf("unexpected reconstructed text:\nwant: %q\ngot:  %q", input, reconstructed)
	}
}

func TestClipSnippetTruncates(t *testing.T) {
	got := ClipSnippet("abcdefghijklmnopqrstuvwxyz", 10)
	if got != "abcdefg..." {
		t.Fatalf("unexpected clipped snippet: %q", got)
	}
}
