"""Base pooling interface."""
from abc import ABC, abstractmethod
from typing import Optional
import torch


class PoolingStrategy(ABC):
    """Abstract base class for pooling strategies."""
    
    @abstractmethod
    def pool(self, hidden_states: torch.Tensor, attention_mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        """
        Pool hidden states to create sentence embeddings.
        
        Args:
            hidden_states: Tensor of shape (batch_size, sequence_length, hidden_size)
            attention_mask: Optional attention mask of shape (batch_size, sequence_length)
            
        Returns:
            Pooled embeddings of shape (batch_size, hidden_size)
        """
        pass


class MeanPooling(PoolingStrategy):
    """Mean pooling strategy."""
    
    def pool(self, hidden_states: torch.Tensor, attention_mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        if attention_mask is None:
            # Simple mean across sequence dimension
            return hidden_states.mean(dim=1)
        
        # Expand attention mask
        attention_mask_expanded = attention_mask.unsqueeze(-1).expand(hidden_states.size()).float()
        
        # Sum hidden states with attention mask
        sum_embeddings = torch.sum(hidden_states * attention_mask_expanded, dim=1)
        
        # Sum attention mask
        sum_mask = torch.clamp(attention_mask_expanded.sum(dim=1), min=1e-9)
        
        # Mean pooling
        return sum_embeddings / sum_mask


class CLSPooling(PoolingStrategy):
    """CLS token pooling strategy."""
    
    def pool(self, hidden_states: torch.Tensor, attention_mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        # Return the CLS token embedding (first token)
        return hidden_states[:, 0]


class MaxPooling(PoolingStrategy):
    """Max pooling strategy."""
    
    def pool(self, hidden_states: torch.Tensor, attention_mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        if attention_mask is None:
            # Simple max across sequence dimension
            return hidden_states.max(dim=1).values
        
        # Expand attention mask
        attention_mask_expanded = attention_mask.unsqueeze(-1).expand(hidden_states.size())
        
        # Set padding tokens to very small value
        hidden_states_masked = hidden_states.clone()
        hidden_states_masked[attention_mask_expanded == 0] = -1e9
        
        # Max pooling
        return hidden_states_masked.max(dim=1).values


def get_pooling_strategy(name: str) -> PoolingStrategy:
    """Get pooling strategy by name."""
    strategies = {
        "mean": MeanPooling,
        "cls": CLSPooling,
        "max": MaxPooling,
    }
    
    if name.lower() not in strategies:
        raise ValueError(f"Unknown pooling strategy: {name}. Available: {list(strategies.keys())}")
    
    return strategies[name.lower()]()