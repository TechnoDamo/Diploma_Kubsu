from pydantic import computed_field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_env: str = "production"
    log_level: str = "INFO"
    log_format: str = "json"

    http_host: str = "0.0.0.0"
    http_port: int = 8080
    http_public_base_url: str = "http://localhost:8080"
    http_read_timeout: int = 600
    http_write_timeout: int = 180
    http_idle_timeout: int = 60
    cors_allow_origins: str = "*"

    upload_max_size_mb: int = 25

    @computed_field
    @property
    def http_max_upload_size_bytes(self) -> int:
        return self.upload_max_size_mb * 1024 * 1024

    postgres_dsn: str = "postgres://mimir:mimir@localhost:5432/mimir_db?sslmode=disable"
    postgres_max_conns: int = 10
    postgres_min_conns: int = 2

    worker_poll_interval: int = 3
    worker_batch_size: int = 10

    files_root_dir: str = "./var/files"
    prompts_dir: str = "./prompts"

    docling_base_url: str = "http://localhost:5001"
    docling_timeout_seconds: int = 300
    use_docling: bool = True

    object_storage_provider: str = "local"
    minio_endpoint: str = "http://minio:9000"
    minio_root_user: str = "minioadmin"
    minio_root_password: str = "minioadmin"
    minio_bucket: str = "mimir-files"
    s3_endpoint_url: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_bucket: str = "mimir-files"
    s3_region: str = "us-east-1"

    llm_base_url: str = "https://api.deepseek.com"
    llm_api_key: str = ""
    llm_model: str = "deepseek-chat"
    llm_http_timeout: int = 120
    llm_ctx_size: int = 2048
    llm_max_retries: int = 3
    llm_retry_delay: int = 5

    embedding_base_url: str = "https://routerai.ru/api/v1"
    embedding_api_key: str = ""
    embedding_api_type: str = "openai_compatible"
    embedding_batch_size: int = 32
    embedding_timeout_seconds: int = 30
    embedding_pooling: str = "mean"
    embedding_max_retries: int = 3
    embedding_retry_delay: int = 5

    tei_base_url: str = "http://localhost:8080"
    tei_http_timeout: int = 180
    tei_embed_batch_size: int = 16
    max_embedding_concurrent_requests: int = 2

    qdrant_url: str = "http://qdrant:6333"
    qdrant_api_key: str = ""
    qdrant_collection_name: str = "mimir_project"
    qdrant_on_disk_payload: bool = True

    sparse_vector_enabled: bool = True
    sparse_model: str = "Qdrant/bm25"

    project_index_defaults_embedding_model_name: str = "qwen/qwen3-embedding-4b"
    project_index_defaults_embedding_dimension: int = 2560
    project_index_defaults_parser_name: str = "docling"
    project_index_defaults_parser_version: str = ""
    project_index_defaults_chunking_strategy: str = "recursive"
    project_index_defaults_chunk_size: int = 1200
    project_index_defaults_chunk_overlap: int = 200
    project_index_defaults_chunk_unit: str = "characters"
    project_index_defaults_tokenizer_name: str = ""

    query_rewrite_default_enabled: bool = True

    rag_dense_weight: float = 0.7
    rag_sparse_weight: float = 0.3
    rag_retrieval_top_k: int = 5
    rag_context_top_n: int = 4

    contradiction_dense_weight: float = 0.3
    contradiction_sparse_weight: float = 0.7
    contradiction_top_k: int = 20
    contradiction_max_distance: float = 0.8
    contradiction_max_candidates_per_target: int = 40
    contradiction_max_pairs_per_job: int = 100
    max_contradiction_retrieval_concurrent_targets: int = 4
    max_contradiction_llm_concurrent_requests: int = 9

    graylog_enabled: bool = True
    graylog_host: str = "graylog"
    graylog_port: int = 12201

    dependency_startup_checks_enabled: bool = True

    generate_summary: bool = True

    summary_segment_size: int = 10000
    max_summary_llm_concurrent_requests: int = 3

    model_config = {"env_prefix": "", "case_sensitive": False}
