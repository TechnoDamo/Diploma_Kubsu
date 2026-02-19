"""Core data types for the embedding worker."""
from dataclasses import dataclass, field
from typing import List, Optional, Any, Dict
from enum import Enum
import time


class PoolingMethod(str, Enum):
    """Pooling methods for extracting embeddings."""
    MEAN = "mean"
    CLS = "cls"
    MAX = "max"


class NormalizationMethod(str, Enum):
    """Normalization methods for embeddings."""
    NONE = "none"
    L2 = "l2"


@dataclass
class EmbeddingRequest:
    """Single embedding request."""
    text: str
    request_id: str = field(default_factory=lambda: str(time.time_ns()))
    model_id: Optional[str] = None
    pooling: PoolingMethod = PoolingMethod.MEAN
    normalization: NormalizationMethod = NormalizationMethod.L2
    max_sequence_length: Optional[int] = None
    created_at: float = field(default_factory=time.time)


@dataclass
class EmbeddingBatch:
    """Batch of embedding requests."""
    requests: List[EmbeddingRequest]
    batch_id: str = field(default_factory=lambda: str(time.time_ns()))
    created_at: float = field(default_factory=time.time)
    
    @property
    def texts(self) -> List[str]:
        """Get all texts from requests."""
        return [req.text for req in self.requests]
    
    @property
    def request_ids(self) -> List[str]:
        """Get all request IDs."""
        return [req.request_id for req in self.requests]


@dataclass
class EmbeddingResult:
    """Result of an embedding request."""
    embedding: List[float]
    request_id: str
    model_info: Dict[str, Any]
    tokens: int
    processing_time_ms: float


@dataclass
class ModelInfo:
    """Information about a loaded model."""
    model_id: str
    embedding_dimension: int
    max_sequence_length: int
    default_pooling: str
    default_normalization: str
    supported_pooling: List[str]
    supported_normalization: List[str]
    device: str
    dtype: str
    loaded_at: float = field(default_factory=time.time)
