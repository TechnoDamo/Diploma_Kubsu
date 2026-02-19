"""Configuration management for the embedding worker."""
from typing import Optional, List
import os
import yaml
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
    config_path: str = "configs/config.yaml"
    model_cache_dir: Optional[str] = None
    revision: Optional[str] = None
    trust_remote_code: bool = True
    device: str = "cpu"  # "cpu" or "cuda"
    dtype: str = "float32"  # "float32" or "float16"
    
    # Batching configuration
    max_batch_size: int = 32
    batch_timeout_ms: int = 50
    
    # Pooling/normalization defaults (optional overrides)
    pooling_method: Optional[str] = None  # "mean", "cls", or "max"
    normalization_method: Optional[str] = None  # "none" or "l2"
    max_sequence_length: Optional[int] = None
    
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
    config = WorkerConfig()

    try:
        with open(config.config_path, "r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except FileNotFoundError:
        return config

    general = data.get("general", {})
    if not isinstance(general, dict):
        return config

    key_map = {
        "grpc_host": "grpc_host",
        "grpc_port": "grpc_port",
        "grpc_max_workers": "grpc_max_workers",
        "grpc_max_message_length": "grpc_max_message_length",
        "model_id": "model_id",
        "revision": "revision",
        "cache_dir": "model_cache_dir",
        "trust_remote_code": "trust_remote_code",
        "device": "device",
        "dtype": "dtype",
        "max_batch_size": "max_batch_size",
        "batch_timeout_ms": "batch_timeout_ms",
        "warmup_on_start": "warmup_on_start",
        "warmup_texts": "warmup_texts",
        "log_level": "log_level",
        "log_format": "log_format",
    }

    for general_key, config_key in key_map.items():
        env_key = f"WORKER_{config_key.upper()}"
        if os.getenv(env_key) is not None:
            continue
        if general_key in general:
            setattr(config, config_key, general[general_key])

    return config
