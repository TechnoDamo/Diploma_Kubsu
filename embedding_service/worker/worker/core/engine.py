"""Embedding engine orchestrates the embedding pipeline."""
import time
from typing import List, Optional
import torch
import numpy as np

from worker.infra.logging import logger
from worker.core.types import EmbeddingRequest, EmbeddingResult, PoolingMethod, NormalizationMethod
from worker.models.loader import ModelLoader
from worker.pooling.base import get_pooling_strategy
from worker.postprocess.normalization import apply_normalization


class EmbeddingEngine:
    """Orchestrates the embedding pipeline."""
    
    def __init__(self, model_loader: ModelLoader):
        """Initialize embedding engine."""
        self.model_loader = model_loader
        self.model_info = None
        
    def warmup(self, texts: List[str]) -> None:
        """Warm up the model with sample texts."""
        logger.info("Warming up model", num_texts=len(texts))
        
        if not texts:
            texts = ["Warmup text"]
        
        # Create simple requests for warmup
        requests = [
            EmbeddingRequest(
                text=text,
                request_id=f"warmup_{i}",
                pooling=PoolingMethod.MEAN,
                normalization=NormalizationMethod.L2,
            )
            for i, text in enumerate(texts)
        ]
        
        # Run a few forward passes
        for i in range(3):
            start_time = time.time()
            results = self.embed_batch(requests)
            elapsed = (time.time() - start_time) * 1000
            logger.debug(
                "Warmup pass completed",
                pass_num=i + 1,
                batch_size=len(texts),
                elapsed_ms=elapsed,
            )
        
        logger.info("Model warmup completed")
    
    def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        """Embed a single text."""
        return self.embed_batch([request])[0]
    
    def embed_batch(self, requests: List[EmbeddingRequest]) -> List[EmbeddingResult]:
        """Embed a batch of texts."""
        if not requests:
            return []

        pooling_method = requests[0].pooling
        normalization_method = requests[0].normalization
        max_sequence_length = requests[0].max_sequence_length

        for request in requests[1:]:
            if request.pooling != pooling_method:
                raise ValueError("Batch requests must use the same pooling method")
            if request.normalization != normalization_method:
                raise ValueError("Batch requests must use the same normalization method")
            if request.max_sequence_length != max_sequence_length:
                raise ValueError("Batch requests must use the same max sequence length")
        
        start_time = time.time()
        texts = [req.text for req in requests]
        
        # Tokenize
        tokenized = self.model_loader.tokenize(texts, max_length=max_sequence_length)
        input_ids = tokenized["input_ids"]
        attention_mask = tokenized.get("attention_mask")
        
        # Encode
        hidden_states = self.model_loader.encode(tokenized)
        
        # Get pooling strategy from first request (assume same for batch)
        pooling_name = pooling_method.value if hasattr(pooling_method, "value") else pooling_method
        pooling_strategy = get_pooling_strategy(pooling_name)
        
        # Pool
        embeddings = pooling_strategy.pool(hidden_states, attention_mask)
        
        # Normalize if requested
        embeddings = apply_normalization(embeddings, normalization_method)
        
        # Convert to numpy
        embeddings_np = embeddings.cpu().numpy()
        
        # Count tokens
        token_counts = attention_mask.sum(dim=1).cpu().numpy() if attention_mask is not None \
            else [len(text.split()) for text in texts]
        
        # Prepare results
        results = []
        for i, request in enumerate(requests):
            result = EmbeddingResult(
                embedding=embeddings_np[i].tolist(),
                request_id=request.request_id,
                model_info={
                    "model_id": self.model_loader.model_id,
                    "embedding_dimension": self.model_loader.model_info.embedding_dimension,
                    "max_sequence_length": self.model_loader.model_info.max_sequence_length,
                },
                tokens=int(token_counts[i]),
                processing_time_ms=(time.time() - start_time) * 1000,
            )
            results.append(result)
        
        logger.debug(
            "Batch embedding completed",
            batch_size=len(requests),
            total_time_ms=(time.time() - start_time) * 1000,
        )
        
        return results
