package docling

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/url"
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
			Timeout: 30 * time.Second,
		},
	}
}

func (c Client) BaseURL() string {
	return c.baseURL
}

func (c Client) ConvertFile(ctx context.Context, filename string, data []byte, mimeType string) (string, error) {
	if shouldUseAsyncConvert(filename, mimeType) {
		if isPDF(filename, mimeType) {
			text, err := c.convertFileAsync(ctx, filename, data, mimeType, false)
			if strings.TrimSpace(text) != "" && err == nil {
				return text, nil
			}
			return c.convertFileAsync(ctx, filename, data, mimeType, true)
		}

		return c.convertFileAsync(ctx, filename, data, mimeType, false)
	}

	return c.convertFileSync(ctx, filename, data, mimeType)
}

func (c Client) convertFileSync(ctx context.Context, filename string, data []byte, mimeType string) (string, error) {
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
	_ = writer.WriteField("target_type", "inbody")
	if format := inferSourceFormat(filename, mimeType); format != "" {
		_ = writer.WriteField("from_formats", format)
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
		var payload map[string]any
		if err := json.NewDecoder(response.Body).Decode(&payload); err == nil {
			return "", fmt.Errorf("docling returned status %d: %v", response.StatusCode, payload)
		}
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

func (c Client) convertFileAsync(ctx context.Context, filename string, data []byte, mimeType string, doOCR bool) (string, error) {
	taskID, err := c.submitAsyncConvert(ctx, filename, data, mimeType, doOCR)
	if err != nil {
		return "", err
	}

	status, err := c.waitForTask(ctx, taskID)
	if err != nil {
		return "", err
	}
	if status.TaskStatus != "success" && status.TaskStatus != "partial_success" {
		if strings.TrimSpace(status.ErrorMessage) != "" {
			return "", fmt.Errorf("docling async task failed: %s", status.ErrorMessage)
		}
		return "", fmt.Errorf("docling async task finished with status %q", status.TaskStatus)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/result/"+url.PathEscape(taskID), nil)
	if err != nil {
		return "", fmt.Errorf("build docling async result request: %w", err)
	}
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("fetch docling async result: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		var payload map[string]any
		if err := json.NewDecoder(response.Body).Decode(&payload); err == nil {
			return "", fmt.Errorf("docling async result returned status %d: %v", response.StatusCode, payload)
		}
		return "", fmt.Errorf("docling async result returned status %d", response.StatusCode)
	}

	var payload any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode docling async result: %w", err)
	}

	text := extractText(payload)
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("docling async result did not contain extracted text")
	}

	return text, nil
}

func (c Client) submitAsyncConvert(ctx context.Context, filename string, data []byte, mimeType string, doOCR bool) (string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	part, err := writer.CreateFormFile("files", filename)
	if err != nil {
		return "", fmt.Errorf("create async multipart file part: %w", err)
	}
	if _, err := part.Write(data); err != nil {
		return "", fmt.Errorf("write async multipart file part: %w", err)
	}

	_ = writer.WriteField("to_formats", "text")
	_ = writer.WriteField("target_type", "inbody")
	_ = writer.WriteField("document_timeout", "3600")
	_ = writer.WriteField("do_ocr", boolToDoclingField(doOCR))
	if format := inferSourceFormat(filename, mimeType); format != "" {
		_ = writer.WriteField("from_formats", format)
	}

	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("close async multipart body: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/convert/file/async", &body)
	if err != nil {
		return "", fmt.Errorf("build docling async request: %w", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("call docling async convert: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		var payload map[string]any
		if err := json.NewDecoder(response.Body).Decode(&payload); err == nil {
			return "", fmt.Errorf("docling async convert returned status %d: %v", response.StatusCode, payload)
		}
		return "", fmt.Errorf("docling async convert returned status %d", response.StatusCode)
	}

	var payload struct {
		TaskID string `json:"task_id"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode docling async convert response: %w", err)
	}
	if strings.TrimSpace(payload.TaskID) == "" {
		return "", fmt.Errorf("docling async convert did not return task_id")
	}

	return payload.TaskID, nil
}

type taskStatusResponse struct {
	TaskID       string `json:"task_id"`
	TaskStatus   string `json:"task_status"`
	ErrorMessage string `json:"error_message"`
}

func (c Client) waitForTask(ctx context.Context, taskID string) (taskStatusResponse, error) {
	for {
		request, err := http.NewRequestWithContext(
			ctx,
			http.MethodGet,
			c.baseURL+"/v1/status/poll/"+url.PathEscape(taskID)+"?wait=5",
			nil,
		)
		if err != nil {
			return taskStatusResponse{}, fmt.Errorf("build docling status poll request: %w", err)
		}
		request.Header.Set("Accept", "application/json")

		response, err := c.httpClient.Do(request)
		if err != nil {
			return taskStatusResponse{}, fmt.Errorf("poll docling task status: %w", err)
		}

		var payload taskStatusResponse
		decodeErr := json.NewDecoder(response.Body).Decode(&payload)
		response.Body.Close()
		if response.StatusCode >= http.StatusBadRequest {
			return taskStatusResponse{}, fmt.Errorf("docling task status returned %d", response.StatusCode)
		}
		if decodeErr != nil {
			return taskStatusResponse{}, fmt.Errorf("decode docling task status: %w", decodeErr)
		}

		switch payload.TaskStatus {
		case "pending", "started":
			continue
		default:
			return payload, nil
		}
	}
}

func shouldUseAsyncConvert(filename, mimeType string) bool {
	lowerName := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lowerName, ".pdf"), mimeType == "application/pdf":
		return true
	case strings.HasSuffix(lowerName, ".docx"), mimeType == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return true
	default:
		return false
	}
}

func isPDF(filename, mimeType string) bool {
	lowerName := strings.ToLower(filename)
	return strings.HasSuffix(lowerName, ".pdf") || mimeType == "application/pdf"
}

func boolToDoclingField(value bool) string {
	if value {
		return "true"
	}
	return "false"
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
