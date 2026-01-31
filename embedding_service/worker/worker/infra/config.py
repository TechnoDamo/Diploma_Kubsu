"""Configuration management for the embedding worker."""
from typing import Optional, List
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerConfig(BaseSettings):
    """Worker configuration."""
    
    model_config = SettingsConfigDict(
        env_prefix="WORKER_",
        case_sensitive=False,
        env_file=".env"
    )
    
    # gRPC server configuration
    grpc_host: str = "0.0.0.0"
    grpc_port: int = 50051
    grpc_max_workers: int = 10
    grpc_max_message_length: int = 100 * 1024 * 1024  # 100MB
    
    # Model configuration
    model_id: str = "ai-forever/ru-en-RoSBERTa"
    model_cache_dir: Optional[str] = None
    device: str = "cpu"  # "cpu" or "cuda"
    dtype: str = "float32"  # "float32" or "float16"
    
    # Batching configuration
    max_batch_size: int = 32
    max_sequence_length: int = 512
    batch_timeout_ms: int = 50
    
    # Pooling configuration
    pooling_method: str = "mean"  # "mean", "cls", or "max"
    normalize_embeddings: bool = True
    
    # Performance configuration
    warmup_on_start: bool = True
    warmup_texts: List[str] = [
        "Hello, world!",
        "This is a test sentence.",
        "Embedding models are powerful."
    ]
    
    # Logging configuration
    log_level: str = "INFO"
    log_format: str = "json"
    
    # Health check configuration
    health_check_interval: int = 30  # seconds
    readiness_timeout: int = 300  # seconds


def get_config() -> WorkerConfig:
    """Get worker configuration."""
    return WorkerConfig()