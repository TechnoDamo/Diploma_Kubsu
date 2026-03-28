package config

import (
	"time"

	"github.com/ilyakaznacheev/cleanenv"
)

type Config struct {
	AppEnv string `env:"APP_ENV" env-default:"development"`

	LogLevel string `env:"LOG_LEVEL" env-default:"INFO"`

	EnableLocalFallbacks bool `env:"ENABLE_LOCAL_FALLBACKS" env-default:"false"`

	HTTP HTTPConfig

	Postgres PostgresConfig

	Worker WorkerConfig

	Files FileStorageConfig

	Prompts PromptConfig

	Docling ExternalServiceConfig `env-prefix:"DOCLING_"`
	TEI     ExternalServiceConfig `env-prefix:"TEI_"`

	LLM LLMConfig

	ProjectIndexDefaults ProjectIndexDefaultsConfig `env-prefix:"PROJECT_INDEX_DEFAULTS_"`

	DependencyStartupChecksEnabled bool `env:"DEPENDENCY_STARTUP_CHECKS_ENABLED" env-default:"true"`

	QueryRewriteDefaultEnabled    bool    `env:"QUERY_REWRITE_DEFAULT_ENABLED" env-default:"true"`
	RAGRetrievalTopK              int     `env:"RAG_RETRIEVAL_TOP_K" env-default:"8"`
	RAGContextTopN                int     `env:"RAG_CONTEXT_TOP_N" env-default:"4"`
	ContradictionMaxDistance      float64 `env:"CONTRADICTION_MAX_DISTANCE" env-default:"0.35"`
	ContradictionTopKPerBaseChunk int     `env:"CONTRADICTION_TOP_K_PER_BASE_CHUNK" env-default:"1"`
	ContradictionMaxPairsPerJob   int     `env:"CONTRADICTION_MAX_PAIRS_PER_JOB" env-default:"50"`
	TEIEmbedBatchSize             int     `env:"TEI_EMBED_BATCH_SIZE" env-default:"64"`
}

type HTTPConfig struct {
	Host               string        `env:"HTTP_HOST" env-default:"0.0.0.0"`
	Port               int           `env:"HTTP_PORT" env-default:"8080"`
	PublicBaseURL      string        `env:"HTTP_PUBLIC_BASE_URL" env-default:"http://localhost:8080"`
	ReadTimeout        time.Duration `env:"HTTP_READ_TIMEOUT" env-default:"15s"`
	WriteTimeout       time.Duration `env:"HTTP_WRITE_TIMEOUT" env-default:"15s"`
	IdleTimeout        time.Duration `env:"HTTP_IDLE_TIMEOUT" env-default:"60s"`
	MaxUploadSizeBytes int64         `env:"HTTP_MAX_UPLOAD_SIZE_BYTES" env-default:"26214400"`
}

type PostgresConfig struct {
	DSN      string `env:"POSTGRES_DSN" env-required:"true"`
	MaxConns int32  `env:"POSTGRES_MAX_CONNS" env-default:"10"`
	MinConns int32  `env:"POSTGRES_MIN_CONNS" env-default:"2"`
}

type WorkerConfig struct {
	PollInterval time.Duration `env:"WORKER_POLL_INTERVAL" env-default:"3s"`
	BatchSize    int           `env:"WORKER_BATCH_SIZE" env-default:"10"`
}

type FileStorageConfig struct {
	RootDir string `env:"FILES_ROOT_DIR" env-default:"./var/files"`
}

type PromptConfig struct {
	Dir string `env:"PROMPTS_DIR" env-default:"./prompts"`
}

type ExternalServiceConfig struct {
	BaseURL string `env:"BASE_URL" env-required:"true"`
}

type LLMConfig struct {
	Provider        string `env:"LLM_PROVIDER" env-default:"deepseek"`
	APIType         string `env:"LLM_API_TYPE" env-default:"openai_compatible"`
	ProviderBaseURL string `env:"LLM_PROVIDER_BASE_URL" env-default:"https://api.deepseek.com"`
	ProviderAPIKey  string `env:"LLM_PROVIDER_API_KEY"`
	ModelName       string `env:"LLM_MODEL_NAME" env-default:"deepseek-chat"`
}

type ProjectIndexDefaultsConfig struct {
	IngestionPipelineID int64  `env:"INGESTION_PIPELINE_ID" env-default:"1"`
	EmbeddingPipelineID int64  `env:"EMBEDDING_PIPELINE_ID" env-default:"1"`
	EmbeddingModelName  string `env:"EMBEDDING_MODEL_NAME" env-default:"Qwen3-Embedding-0.6B"`
	EmbeddingDimension  int32  `env:"EMBEDDING_DIMENSION" env-default:"1024"`
	ParserName          string `env:"PARSER_NAME" env-default:"docling"`
	ParserVersion       string `env:"PARSER_VERSION"`
	ChunkingStrategy    string `env:"CHUNKING_STRATEGY" env-default:"recursive"`
	ChunkSize           int32  `env:"CHUNK_SIZE" env-default:"1200"`
	ChunkOverlap        int32  `env:"CHUNK_OVERLAP" env-default:"200"`
	ChunkUnit           string `env:"CHUNK_UNIT" env-default:"characters"`
	TokenizerName       string `env:"TOKENIZER_NAME"`
}

func Load() (Config, error) {
	var cfg Config
	if err := cleanenv.ReadEnv(&cfg); err != nil {
		return Config{}, err
	}

	return cfg, nil
}
