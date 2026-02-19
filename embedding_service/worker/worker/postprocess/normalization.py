"""Embedding normalization."""
import torch
import numpy as np

from worker.core.types import NormalizationMethod


def apply_normalization(embeddings: torch.Tensor, method: NormalizationMethod) -> torch.Tensor:
    """Normalize embeddings according to the selected method."""
    if method == NormalizationMethod.NONE:
        return embeddings

    if method == NormalizationMethod.L2:
        eps = 1e-12
        norm = torch.norm(embeddings, p=2, dim=1, keepdim=True)
        return embeddings / (norm + eps)

    raise ValueError(f"Unknown normalization method: {method}")


def normalize_numpy_embeddings(embeddings: np.ndarray) -> np.ndarray:
    """Normalize numpy embeddings to unit length using L2 norm."""
    eps = 1e-12
    norm = np.linalg.norm(embeddings, axis=1, keepdims=True)
    return embeddings / (norm + eps)
