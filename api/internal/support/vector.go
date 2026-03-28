package support

import (
	"crypto/sha256"
	"fmt"
	"math"
	"strings"
)

func DeterministicEmbedding(text string, dimensions int) []float32 {
	if dimensions <= 0 {
		dimensions = 384
	}

	vector := make([]float32, dimensions)
	seed := []byte(text)
	for i := 0; i < dimensions; i++ {
		hash := sha256.Sum256(append(seed, byte(i%251), byte((i/251)%251)))
		value := float64(int(hash[0])<<8|int(hash[1])) / 65535.0
		vector[i] = float32((value * 2) - 1)
	}

	normalizeVector(vector)
	return vector
}

func VectorLiteral(vector []float32) string {
	values := make([]string, 0, len(vector))
	for _, value := range vector {
		values = append(values, fmt.Sprintf("%f", value))
	}
	return "[" + strings.Join(values, ",") + "]"
}

func normalizeVector(vector []float32) {
	var sum float64
	for _, value := range vector {
		sum += float64(value * value)
	}
	if sum == 0 {
		return
	}

	magnitude := float32(math.Sqrt(sum))
	for i := range vector {
		vector[i] /= magnitude
	}
}
