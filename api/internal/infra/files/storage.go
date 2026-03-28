package files

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Storage struct {
	rootDir string
}

type SavedFile struct {
	RelativePath string
	SizeBytes    int64
	Checksum     string
}

func New(rootDir string) Storage {
	return Storage{rootDir: rootDir}
}

func (s Storage) RootDir() string {
	return s.rootDir
}

func (s Storage) EnsureRootDir() error {
	return os.MkdirAll(s.rootDir, 0o755)
}

func (s Storage) Save(ctx context.Context, originalName string, reader io.Reader) (SavedFile, error) {
	if err := s.EnsureRootDir(); err != nil {
		return SavedFile{}, fmt.Errorf("ensure file storage root: %w", err)
	}

	relativePath := buildRelativePath(originalName)
	absolutePath := filepath.Join(s.rootDir, relativePath)

	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		return SavedFile{}, fmt.Errorf("create file storage directory: %w", err)
	}

	tmpPath := absolutePath + ".tmp"
	file, err := os.Create(tmpPath)
	if err != nil {
		return SavedFile{}, fmt.Errorf("create temporary file: %w", err)
	}

	defer func() {
		_ = file.Close()
	}()

	hasher := sha256.New()
	writer := io.MultiWriter(file, hasher)

	written, err := copyWithContext(ctx, writer, reader)
	if err != nil {
		_ = os.Remove(tmpPath)
		return SavedFile{}, fmt.Errorf("write uploaded file: %w", err)
	}

	if err := file.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return SavedFile{}, fmt.Errorf("close temporary file: %w", err)
	}

	if err := os.Rename(tmpPath, absolutePath); err != nil {
		_ = os.Remove(tmpPath)
		return SavedFile{}, fmt.Errorf("move temporary file into place: %w", err)
	}

	return SavedFile{
		RelativePath: relativePath,
		SizeBytes:    written,
		Checksum:     hex.EncodeToString(hasher.Sum(nil)),
	}, nil
}

func (s Storage) Open(relativePath string) (*os.File, error) {
	file, err := os.Open(filepath.Join(s.rootDir, relativePath))
	if err != nil {
		return nil, fmt.Errorf("open stored file: %w", err)
	}
	return file, nil
}

func (s Storage) ReadAll(relativePath string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(s.rootDir, relativePath))
	if err != nil {
		return nil, fmt.Errorf("read stored file: %w", err)
	}
	return data, nil
}

func (s Storage) Delete(relativePath string) error {
	err := os.Remove(filepath.Join(s.rootDir, relativePath))
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete stored file: %w", err)
	}
	return nil
}

func buildRelativePath(originalName string) string {
	now := time.Now().UTC()
	safeName := sanitizeFileName(originalName)
	randomSuffix := randomHex(8)

	return filepath.Join(
		fmt.Sprintf("%04d", now.Year()),
		fmt.Sprintf("%02d", now.Month()),
		fmt.Sprintf("%02d", now.Day()),
		randomSuffix+"_"+safeName,
	)
}

func sanitizeFileName(originalName string) string {
	name := filepath.Base(strings.TrimSpace(originalName))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "document.bin"
	}

	replacer := strings.NewReplacer("/", "_", "\\", "_", " ", "_", ":", "_")
	name = replacer.Replace(name)
	if name == "" {
		return "document.bin"
	}

	return name
}

func randomHex(size int) string {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer)
}

func copyWithContext(ctx context.Context, writer io.Writer, reader io.Reader) (int64, error) {
	buffer := make([]byte, 32*1024)
	var total int64

	for {
		select {
		case <-ctx.Done():
			return total, ctx.Err()
		default:
		}

		readBytes, readErr := reader.Read(buffer)
		if readBytes > 0 {
			writtenBytes, writeErr := writer.Write(buffer[:readBytes])
			total += int64(writtenBytes)
			if writeErr != nil {
				return total, writeErr
			}
			if writtenBytes != readBytes {
				return total, io.ErrShortWrite
			}
		}

		if readErr != nil {
			if readErr == io.EOF {
				return total, nil
			}
			return total, readErr
		}
	}
}
