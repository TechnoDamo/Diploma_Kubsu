package docling

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
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
			Timeout: 2 * time.Minute,
		},
	}
}

func (c Client) BaseURL() string {
	return c.baseURL
}

func (c Client) ConvertFile(ctx context.Context, filename string, data []byte, mimeType string) (string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	part, err := writer.CreateFormFile("files", filename)
	if err != nil {
		return "", fmt.Errorf("create multipart file part: %w", err)
	}
	if _, err := part.Write(data); err != nil {
		return "", fmt.Errorf("write multipart file part: %w", err)
	}

	_ = writer.WriteField("to_formats", "text")
	_ = writer.WriteField("target_type", "INBODY")
	if mimeType != "" {
		_ = writer.WriteField("from_formats", inferSourceFormat(filename, mimeType))
	}

	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("close multipart body: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/convert/file", &body)
	if err != nil {
		return "", fmt.Errorf("build docling request: %w", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("call docling: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		return "", fmt.Errorf("docling returned status %d", response.StatusCode)
	}

	var payload any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode docling response: %w", err)
	}

	text := extractText(payload)
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("docling response did not contain extracted text")
	}

	return text, nil
}

func inferSourceFormat(filename, mimeType string) string {
	lowerName := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lowerName, ".pdf"), mimeType == "application/pdf":
		return "pdf"
	case strings.HasSuffix(lowerName, ".docx"), mimeType == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return "docx"
	case strings.HasSuffix(lowerName, ".md"), mimeType == "text/markdown":
		return "md"
	case strings.HasSuffix(lowerName, ".txt"), strings.HasPrefix(mimeType, "text/plain"):
		return "text"
	default:
		return ""
	}
}

func extractText(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"text", "md", "markdown", "body", "content"} {
			if nested, ok := typed[key]; ok {
				if result := extractText(nested); strings.TrimSpace(result) != "" {
					return result
				}
			}
		}
		longest := ""
		for _, nested := range typed {
			if result := extractText(nested); len(strings.TrimSpace(result)) > len(strings.TrimSpace(longest)) {
				longest = result
			}
		}
		return longest
	case []any:
		longest := ""
		for _, item := range typed {
			if result := extractText(item); len(strings.TrimSpace(result)) > len(strings.TrimSpace(longest)) {
				longest = result
			}
		}
		return longest
	case string:
		return typed
	default:
		return ""
	}
}
