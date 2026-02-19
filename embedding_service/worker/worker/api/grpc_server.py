"""gRPC server implementation for the embedding worker."""
import asyncio
import time
from concurrent import futures
from typing import Optional
import grpc

from worker.v1 import worker_pb2, worker_pb2_grpc
from worker.infra.logging import logger, configure_logging
from worker.infra.config import get_config
from worker.core.types import EmbeddingRequest, PoolingMethod
from worker.models.loader import ModelLoader
from worker.core.engine import EmbeddingEngine


class WorkerServicer(worker_pb2_grpc.WorkerServiceServicer):
    """gRPC servicer for the embedding worker."""
    
    def __init__(self, engine: EmbeddingEngine):
        """Initialize the servicer."""
        self.engine = engine
        self.start_time = time.time()
        
    def Embed(self, request: worker_pb2.EmbedRequest, context) -> worker_pb2.EmbedResponse:
        """Handle single embedding request."""
        logger.info("Processing Embed request", text_length=len(request.text))
        
        # Convert proto request to internal type
        embedding_request = EmbeddingRequest(
            text=request.text,
            model_id=request.model_id or None,
            pooling=PoolingMethod(request.pooling) if request.pooling else PoolingMethod.MEAN,
            normalize=request.normalize if request.HasField("normalize") else True,
        )
        
        # Process request
        result = self.engine.embed(embedding_request)
        
        # Convert to proto response
        return worker_pb2.EmbedResponse(
            embedding=result.embedding,
            model_info=worker_pb2.ModelInfo(
                model_id=result.model_info["model_id"],
                embedding_dimension=result.model_info["embedding_dimension"],
                max_sequence_length=result.model_info["max_sequence_length"],
            ),
            tokens=result.tokens,
        )
    
    def EmbedBatch(self, request: worker_pb2.EmbedBatchRequest, context) -> worker_pb2.EmbedBatchResponse:
        """Handle batch embedding request."""
        logger.info("Processing EmbedBatch request", batch_size=len(request.texts))
        
        # Convert proto requests to internal types
        embedding_requests = []
        for text in request.texts:
            embedding_requests.append(
                EmbeddingRequest(
                    text=text,
                    model_id=request.model_id or None,
                    pooling=PoolingMethod(request.pooling) if request.pooling else PoolingMethod.MEAN,
                    normalize=request.normalize if request.HasField("normalize") else True,
                )
            )
        
        # Process batch
        results = self.engine.embed_batch(embedding_requests)
        
        # Convert to proto response
        response = worker_pb2.EmbedBatchResponse()
        for result in results:
            response.embeddings.append(
                worker_pb2.EmbedResponse(
                    embedding=result.embedding,
                    model_info=worker_pb2.ModelInfo(
                        model_id=result.model_info["model_id"],
                        embedding_dimension=result.model_info["embedding_dimension"],
                        max_sequence_length=result.model_info["max_sequence_length"],
                    ),
                    tokens=result.tokens,
                )
            )
        
        return response
    
    def HealthCheck(self, request: worker_pb2.HealthCheckRequest, context) -> worker_pb2.HealthCheckResponse:
        """Handle health check request."""
        return worker_pb2.HealthCheckResponse(
            healthy=True,
            status="OK",
            uptime_seconds=int(time.time() - self.start_time),
        )
    
    def GetModelInfo(self, request: worker_pb2.ModelInfoRequest, context) -> worker_pb2.ModelInfoResponse:
        """Handle model info request."""
        model_info = self.engine.model_loader.model_info
        
        return worker_pb2.ModelInfoResponse(
            model_id=model_info.model_id,
            embedding_dimension=model_info.embedding_dimension,
            max_sequence_length=model_info.max_sequence_length,
            pooling_method=model_info.pooling_method,
            supports_normalization=model_info.supports_normalization,
            device=model_info.device,
            dtype=model_info.dtype,
        )


def serve() -> None:
    """Start the gRPC server."""
    # Configure logging
    configure_logging()
    
    # Get configuration
    config = get_config()
    
    logger.info("Starting embedding worker", config=config.model_dump())
    
    # Initialize model
    model_loader = ModelLoader(
        model_id=config.model_id,
        device=config.device,
        dtype=config.dtype,
        cache_dir=config.model_cache_dir,
    )
    
    model_info = model_loader.load()
    
    # Initialize engine
    engine = EmbeddingEngine(model_loader)
    
    # Warm up if configured
    if config.warmup_on_start:
        engine.warmup(config.warmup_texts)
    
    # Create gRPC server
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=config.grpc_max_workers),
        options=[
            ("grpc.max_send_message_length", config.grpc_max_message_length),
            ("grpc.max_receive_message_length", config.grpc_max_message_length),
        ],
    )
    
    # Add servicer
    worker_pb2_grpc.add_WorkerServiceServicer_to_server(
        WorkerServicer(engine), server
    )
    
    # Start server
    server.add_insecure_port(f"{config.grpc_host}:{config.grpc_port}")
    server.start()
    
    logger.info(
        "gRPC server started",
        host=config.grpc_host,
        port=config.grpc_port,
        model_id=model_info.model_id,
        embedding_dim=model_info.embedding_dimension,
    )
    
    # Keep server running
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logger.info("Shutting down server")
        server.stop(0)
        model_loader.unload()
        logger.info("Server shutdown complete")


if __name__ == "__main__":
    serve()