package tei

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func New(baseURL string, timeout time.Duration) Client {
	if timeout <= 0 {
		timeout = 180 * time.Second
	}
	return Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c Client) BaseURL() string {
	return c.baseURL
}

func (c Client) CheckAvailability(ctx context.Context, dimensions int) error {
	if strings.TrimSpace(c.baseURL) == "" {
		return fmt.Errorf("tei base url is empty")
	}

	vectors, err := c.Embed(ctx, []string{"healthcheck"}, dimensions)
	if err != nil {
		return err
	}
	if len(vectors) != 1 {
		return fmt.Errorf("tei availability check returned %d embeddings", len(vectors))
	}

	return nil
}

func (c Client) Embed(ctx context.Context, inputs []string, dimensions int) ([][]float32, error) {
	if len(inputs) == 0 {
		return nil, fmt.Errorf("embed inputs must not be empty")
	}

	// The backend uses the same TEI contract for indexing batches and single
	// query embeddings during retrieval.
	requestBody := map[string]any{
		"inputs": inputs,
	}
	if dimensions > 0 {
		requestBody["dimensions"] = dimensions
	}

	payload, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("marshal tei request: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/embed", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("build tei request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call tei: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("tei returned status %d", response.StatusCode)
	}

	var raw any
	if err := json.NewDecoder(response.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode tei response: %w", err)
	}

	// Different TEI-compatible deployments may wrap the returned vectors in
	// slightly different JSON envelopes, so decoding accepts several shapes.
	vectors, err := decodeEmbeddings(raw)
	if err != nil {
		return nil, err
	}

	if len(vectors) != len(inputs) {
		return nil, fmt.Errorf("tei returned %d embeddings for %d inputs", len(vectors), len(inputs))
	}

	return vectors, nil
}

func decodeEmbeddings(value any) ([][]float32, error) {
	switch typed := value.(type) {
	case []any:
		if len(typed) == 0 {
			return [][]float32{}, nil
		}
		switch typed[0].(type) {
		case map[string]any:
			result := make([][]float32, 0, len(typed))
			for _, item := range typed {
				object, ok := item.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("unexpected tei embedding object")
				}
				for _, key := range []string{"embedding", "vector"} {
					if rawEmbedding, exists := object[key]; exists {
						vector, err := decodeVector(rawEmbedding)
						if err != nil {
							return nil, err
						}
						result = append(result, vector)
						break
					}
				}
			}
			return result, nil
		case []any:
			result := make([][]float32, 0, len(typed))
			for _, item := range typed {
				vector, err := decodeVector(item)
				if err != nil {
					return nil, err
				}
				result = append(result, vector)
			}
			return result, nil
		default:
			vector, err := decodeVector(typed)
			if err != nil {
				return nil, err
			}
			return [][]float32{vector}, nil
		}
	case map[string]any:
		for _, key := range []string{"embeddings", "data", "results"} {
			if nested, exists := typed[key]; exists {
				return decodeEmbeddings(nested)
			}
		}
		for _, key := range []string{"embedding", "vector"} {
			if nested, exists := typed[key]; exists {
				vector, err := decodeVector(nested)
				if err != nil {
					return nil, err
				}
				return [][]float32{vector}, nil
			}
		}
		return nil, fmt.Errorf("unexpected tei response object format")
	default:
		return nil, fmt.Errorf("unexpected tei response format")
	}
}

func decodeVector(value any) ([]float32, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("unexpected vector value")
	}

	vector := make([]float32, 0, len(items))
	for _, item := range items {
		switch number := item.(type) {
		case float64:
			vector = append(vector, float32(number))
		case float32:
			vector = append(vector, number)
		case int:
			vector = append(vector, float32(number))
		case int32:
			vector = append(vector, float32(number))
		case int64:
			vector = append(vector, float32(number))
		case json.Number:
			parsed, err := number.Float64()
			if err != nil {
				return nil, fmt.Errorf("unexpected json number in vector: %w", err)
			}
			vector = append(vector, float32(parsed))
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(number), 32)
			if err != nil {
				return nil, fmt.Errorf("unexpected string vector element %q", number)
			}
			vector = append(vector, float32(parsed))
		default:
			return nil, fmt.Errorf("unexpected vector element type %T", item)
		}
	}

	return vector, nil
}
