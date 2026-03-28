package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"mimir/api/internal/config"
)

const (
	APITypeOpenAICompatible = "openai_compatible"
)

type CompletionRequest struct {
	SystemPrompt string
	UserPrompt   string
	JSONMode     bool
}

type CompletionResponse struct {
	Text string
}

type Client interface {
	Complete(ctx context.Context, input CompletionRequest) (CompletionResponse, error)
	CheckAvailability(ctx context.Context) error
}

type openAICompatibleClient struct {
	provider   string
	baseURL    string
	apiKey     string
	model      string
	httpClient *http.Client
}

func NewClient(cfg config.LLMConfig) (Client, error) {
	switch strings.TrimSpace(strings.ToLower(cfg.APIType)) {
	case APITypeOpenAICompatible:
		return newOpenAICompatibleClient(cfg), nil
	default:
		return nil, fmt.Errorf("unsupported llm api type %q", cfg.APIType)
	}
}

func newOpenAICompatibleClient(cfg config.LLMConfig) Client {
	return openAICompatibleClient{
		provider: strings.TrimSpace(cfg.Provider),
		baseURL:  strings.TrimRight(strings.TrimSpace(cfg.ProviderBaseURL), "/"),
		apiKey:   strings.TrimSpace(cfg.ProviderAPIKey),
		model:    strings.TrimSpace(cfg.ModelName),
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

func (c openAICompatibleClient) Complete(ctx context.Context, input CompletionRequest) (CompletionResponse, error) {
	if c.apiKey == "" {
		return CompletionResponse{}, fmt.Errorf("llm api key is empty for provider %q", c.provider)
	}
	if c.baseURL == "" {
		return CompletionResponse{}, fmt.Errorf("llm base url is empty for provider %q", c.provider)
	}
	if c.model == "" {
		return CompletionResponse{}, fmt.Errorf("llm model name is empty for provider %q", c.provider)
	}

	requestBody := map[string]any{
		"model": c.model,
		"messages": []map[string]string{
			{"role": "system", "content": input.SystemPrompt},
			{"role": "user", "content": input.UserPrompt},
		},
	}
	if input.JSONMode {
		requestBody["response_format"] = map[string]string{"type": "json_object"}
	}

	payload, err := json.Marshal(requestBody)
	if err != nil {
		return CompletionResponse{}, fmt.Errorf("marshal llm request: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return CompletionResponse{}, fmt.Errorf("build llm request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+c.apiKey)

	response, err := c.httpClient.Do(request)
	if err != nil {
		return CompletionResponse{}, fmt.Errorf("call llm provider %q: %w", c.provider, err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		return CompletionResponse{}, fmt.Errorf("llm provider %q returned status %d", c.provider, response.StatusCode)
	}

	var payloadResponse struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.NewDecoder(response.Body).Decode(&payloadResponse); err != nil {
		return CompletionResponse{}, fmt.Errorf("decode llm response: %w", err)
	}
	if len(payloadResponse.Choices) == 0 {
		return CompletionResponse{}, fmt.Errorf("llm response contained no choices")
	}

	return CompletionResponse{Text: payloadResponse.Choices[0].Message.Content}, nil
}

func (c openAICompatibleClient) CheckAvailability(ctx context.Context) error {
	response, err := c.Complete(ctx, CompletionRequest{
		SystemPrompt: "Reply with the single word OK.",
		UserPrompt:   "Healthcheck",
	})
	if err != nil {
		return err
	}
	if strings.TrimSpace(response.Text) == "" {
		return fmt.Errorf("llm healthcheck returned empty response")
	}
	return nil
}
