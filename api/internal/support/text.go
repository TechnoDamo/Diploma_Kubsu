package support

import "strings"

type Chunk struct {
	OrderID    int
	Text       string
	CharStart  int
	CharEnd    int
	CharCount  int
	TokenCount int
}

func ApproximateTokenCount(text string) int {
	return len(strings.Fields(text))
}

func ChunkText(text string, chunkSize, overlap int) []Chunk {
	if chunkSize <= 0 {
		chunkSize = 1200
	}
	if overlap < 0 {
		overlap = 0
	}
	if overlap >= chunkSize {
		overlap = chunkSize / 4
	}

	if strings.TrimSpace(text) == "" {
		return nil
	}

	runes := []rune(text)
	chunks := make([]Chunk, 0)
	orderID := 0
	start := 0
	for start < len(runes) {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		} else {
			window := runes[start:end]
			if cut := lastPreferredBreak(window); cut > chunkSize/2 {
				end = start + cut + 1
			}
		}

		chunkText := string(runes[start:end])
		if strings.TrimSpace(chunkText) != "" {
			chunks = append(chunks, Chunk{
				OrderID:    orderID,
				Text:       chunkText,
				CharStart:  start,
				CharEnd:    end,
				CharCount:  end - start,
				TokenCount: ApproximateTokenCount(chunkText),
			})
			orderID++
		}

		if end == len(runes) {
			break
		}

		start = end - overlap
		if start < 0 {
			start = 0
		}
		if start >= end {
			start = end
		}
	}

	return chunks
}

func lastPreferredBreak(window []rune) int {
	for index := len(window) - 1; index >= 0; index-- {
		switch window[index] {
		case '\n', ' ', '.', '!', '?', ';', ',':
			return index
		}
	}
	return -1
}

func ReconstructText(chunks []Chunk) string {
	if len(chunks) == 0 {
		return ""
	}

	maxEnd := 0
	for _, chunk := range chunks {
		if chunk.CharEnd > maxEnd {
			maxEnd = chunk.CharEnd
		}
	}
	if maxEnd <= 0 {
		return ""
	}

	reconstructed := make([]rune, maxEnd)
	for _, chunk := range chunks {
		start := chunk.CharStart
		if start < 0 || start >= len(reconstructed) {
			continue
		}

		chunkRunes := []rune(chunk.Text)
		end := chunk.CharEnd
		if expected := start + len(chunkRunes); end > expected {
			end = expected
		}
		if end > len(reconstructed) {
			end = len(reconstructed)
		}
		if end <= start {
			continue
		}

		copy(reconstructed[start:end], chunkRunes[:end-start])
	}

	return string(reconstructed)
}

func ClipSnippet(text string, maxLen int) string {
	text = strings.TrimSpace(text)
	if maxLen <= 0 || len(text) <= maxLen {
		return text
	}

	if maxLen <= 3 {
		return text[:maxLen]
	}
	return text[:maxLen-3] + "..."
}
