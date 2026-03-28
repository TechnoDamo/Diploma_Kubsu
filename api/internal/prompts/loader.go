package prompts

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	RAGRequestFilename             = "rag_request.txt"
	RAGResponseFilename            = "rag_response.txt"
	ContradictionDiscoveryFilename = "contradiction_discovery.txt"
	ContradictionSummaryFilename   = "contradiction_summary.txt"
)

type Bundle struct {
	RAGRequest             string
	RAGResponse            string
	ContradictionDiscovery string
	ContradictionSummary   string
}

func Load(dir string) (Bundle, error) {
	ragRequest, err := loadPromptFile(dir, RAGRequestFilename)
	if err != nil {
		return Bundle{}, err
	}

	ragResponse, err := loadPromptFile(dir, RAGResponseFilename)
	if err != nil {
		return Bundle{}, err
	}

	contradictionDiscovery, err := loadPromptFile(dir, ContradictionDiscoveryFilename)
	if err != nil {
		return Bundle{}, err
	}

	contradictionSummary, err := loadPromptFile(dir, ContradictionSummaryFilename)
	if err != nil {
		return Bundle{}, err
	}

	return Bundle{
		RAGRequest:             ragRequest,
		RAGResponse:            ragResponse,
		ContradictionDiscovery: contradictionDiscovery,
		ContradictionSummary:   contradictionSummary,
	}, nil
}

func loadPromptFile(dir, filename string) (string, error) {
	path := filepath.Join(dir, filename)
	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read prompt file %s: %w", path, err)
	}

	value := strings.TrimSpace(string(content))
	if value == "" {
		return "", fmt.Errorf("prompt file %s is empty", path)
	}

	return value, nil
}
