package support

import (
	"strings"
	"testing"
)

func TestDeterministicEmbeddingIsStable(t *testing.T) {
	first := DeterministicEmbedding("hello world", 8)
	second := DeterministicEmbedding("hello world", 8)

	if len(first) != 8 || len(second) != 8 {
		t.Fatalf("unexpected embedding length")
	}

	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("embedding is not deterministic at index %d", i)
		}
	}
}

func TestVectorLiteralShape(t *testing.T) {
	literal := VectorLiteral([]float32{1.25, -2.5, 3})
	if !strings.HasPrefix(literal, "[") || !strings.HasSuffix(literal, "]") {
		t.Fatalf("vector literal must be bracketed, got %q", literal)
	}
	if !strings.Contains(literal, ",") {
		t.Fatalf("vector literal must contain separators, got %q", literal)
	}
}
