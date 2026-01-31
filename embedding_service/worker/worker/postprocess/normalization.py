"""Embedding normalization."""
import torch
import numpy as np


def normalize_embeddings(embeddings: torch.Tensor) -> torch.Tensor:
    """
    Normalize embeddings to unit length.
    
    Args:
        embeddings: Tensor of shape (batch_size, hidden_size)
        
    Returns:
        Normalized embeddings of same shape
    """
    # Add small epsilon to avoid division by zero
    eps = 1e-12
    
    # Compute L2 norm
    norm = torch.norm(embeddings, p=2, dim=1, keepdim=True)
    
    # Normalize
    normalized = embeddings / (norm + eps)
    
    return normalized


def normalize_numpy_embeddings(embeddings: np.ndarray) -> np.ndarray:
    """
    Normalize numpy embeddings to unit length.
    
    Args:
        embeddings: Array of shape (batch_size, hidden_size)
        
    Returns:
        Normalized embeddings of same shape
    """
    # Add small epsilon to avoid division by zero
    eps = 1e-12
    
    # Compute L2 norm
    norm = np.linalg.norm(embeddings, axis=1, keepdim=True)
    
    # Normalize
    normalized = embeddings / (norm + eps)
    
    return normalized