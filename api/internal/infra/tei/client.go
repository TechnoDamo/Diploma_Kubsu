package tei

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func New(baseURL string) Client {
	return Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (c Client) BaseURL() string {
	return c.baseURL
}

func (c Client) Embed(ctx context.Context, inputs []string, dimensions int) ([][]float32, error) {
	if len(inputs) == 0 {
		return nil, fmt.Errorf("embed inputs must not be empty")
	}

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
		default:
			vector, err := decodeVector(typed)
			if err != nil {
				return nil, err
			}
			return [][]float32{vector}, nil
		}
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
		default:
			return nil, fmt.Errorf("unexpected vector element type")
		}
	}

	return vector, nil
}
