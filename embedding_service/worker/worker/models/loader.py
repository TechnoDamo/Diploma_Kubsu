"""Model loading and management."""
import os
from typing import Optional, Dict, Any
import torch
from transformers import AutoModel, AutoTokenizer
import numpy as np

from worker.infra.logging import logger
from worker.core.types import ModelInfo


class ModelLoader:
    """Loads and manages embedding models."""
    
    def __init__(
        self,
        model_id: str,
        device: str = "cpu",
        dtype: str = "float32",
        cache_dir: Optional[str] = None,
        revision: Optional[str] = None,
        trust_remote_code: bool = True,
    ):
        """Initialize model loader."""
        self.model_id = model_id
        self.device = device
        self.dtype = dtype
        self.cache_dir = cache_dir
        self.revision = revision
        self.trust_remote_code = trust_remote_code
        
        self.model = None
        self.tokenizer = None
        self.model_info = None
        
    def load(
        self,
        default_pooling: str,
        default_normalization: str,
        supported_pooling: list[str],
        supported_normalization: list[str],
        max_sequence_length_override: Optional[int] = None,
    ) -> ModelInfo:
        """Load the model and tokenizer."""
        logger.info(
            "Loading model",
            model_id=self.model_id,
            device=self.device,
            dtype=self.dtype,
        )
        
        # Set torch dtype
        torch_dtype = torch.float32
        if self.dtype == "float16":
            torch_dtype = torch.float16
        elif self.dtype == "bfloat16":
            torch_dtype = torch.bfloat16
        
        # Load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(
            self.model_id,
            cache_dir=self.cache_dir,
            revision=self.revision,
            trust_remote_code=self.trust_remote_code,
        )
        
        # Load model
        self.model = AutoModel.from_pretrained(
            self.model_id,
            cache_dir=self.cache_dir,
            torch_dtype=torch_dtype,
            revision=self.revision,
            trust_remote_code=self.trust_remote_code,
        )
        
        # Move to device
        self.model = self.model.to(self.device)
        self.model.eval()  # Set to evaluation mode
        
        # Get model info
        self.model_info = self._get_model_info(
            default_pooling=default_pooling,
            default_normalization=default_normalization,
            supported_pooling=supported_pooling,
            supported_normalization=supported_normalization,
            max_sequence_length_override=max_sequence_length_override,
        )
        
        logger.info(
            "Model loaded successfully",
            model_id=self.model_id,
            embedding_dim=self.model_info.embedding_dimension,
            max_length=self.model_info.max_sequence_length,
        )
        
        return self.model_info
    
    def _get_model_info(
        self,
        default_pooling: str,
        default_normalization: str,
        supported_pooling: list[str],
        supported_normalization: list[str],
        max_sequence_length_override: Optional[int],
    ) -> ModelInfo:
        """Extract information about the loaded model."""
        # Get embedding dimension
        if hasattr(self.model.config, "hidden_size"):
            embedding_dim = self.model.config.hidden_size
        elif hasattr(self.model.config, "d_model"):
            embedding_dim = self.model.config.d_model
        else:
            # Try to infer from model parameters
            for param in self.model.parameters():
                if param.ndim == 2:
                    embedding_dim = param.shape[1]
                    break
            else:
                embedding_dim = 768  # Default fallback
        
        # Get max sequence length
        if max_sequence_length_override is not None:
            max_length = max_sequence_length_override
        elif hasattr(self.tokenizer, "model_max_length"):
            max_length = self.tokenizer.model_max_length
        elif hasattr(self.model.config, "max_position_embeddings"):
            max_length = self.model.config.max_position_embeddings
        else:
            max_length = 512  # Default fallback
        
        return ModelInfo(
            model_id=self.model_id,
            embedding_dimension=embedding_dim,
            max_sequence_length=max_length,
            default_pooling=default_pooling,
            default_normalization=default_normalization,
            supported_pooling=supported_pooling,
            supported_normalization=supported_normalization,
            device=self.device,
            dtype=self.dtype,
        )
    
    def tokenize(self, texts: list[str], max_length: Optional[int] = None) -> Dict[str, torch.Tensor]:
        """Tokenize a list of texts."""
        if max_length is None:
            max_length = self.model_info.max_sequence_length
        
        return self.tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        )
    
    def encode(self, inputs: Dict[str, torch.Tensor]) -> torch.Tensor:
        """Generate embeddings from tokenized inputs."""
        with torch.no_grad():
            # Move inputs to device
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            # Forward pass
            outputs = self.model(**inputs)
            
            # Get last hidden states
            last_hidden_state = outputs.last_hidden_state
            
            return last_hidden_state
    
    def unload(self) -> None:
        """Unload the model to free memory."""
        if self.model is not None:
            del self.model
            self.model = None
        
        if self.tokenizer is not None:
            del self.tokenizer
            self.tokenizer = None
        
        self.model_info = None
        
        # Clear CUDA cache if using GPU
        if self.device == "cuda":
            torch.cuda.empty_cache()
        
        logger.info("Model unloaded", model_id=self.model_id)
