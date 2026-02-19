"""gRPC server implementation for the embedding worker."""
import signal
import threading
import time
from concurrent import futures
import grpc

from worker.v1 import worker_pb2, worker_pb2_grpc
from worker.infra.logging import logger, configure_logging
from worker.infra.config import get_config
from worker.core.types import EmbeddingRequest, PoolingMethod, NormalizationMethod
from worker.models.loader import ModelLoader
from worker.models.registry import ModelRegistry
from worker.core.engine import EmbeddingEngine


class WorkerServicer(worker_pb2_grpc.WorkerServiceServicer):
    """gRPC servicer for the embedding worker."""
    
    def __init__(
        self,
        engine: EmbeddingEngine,
        default_pooling: PoolingMethod,
        default_normalization: NormalizationMethod,
        default_max_sequence_length: int,
        supported_pooling: list[PoolingMethod],
        supported_normalization: list[NormalizationMethod],
        ready_event: threading.Event,
    ):
        """Initialize the servicer."""
        self.engine = engine
        self.start_time = time.time()
        self.default_pooling = default_pooling
        self.default_normalization = default_normalization
        self.default_max_sequence_length = default_max_sequence_length
        self.supported_pooling = supported_pooling
        self.supported_normalization = supported_normalization
        self.ready_event = ready_event

        self._pooling_map = {
            worker_pb2.POOLING_METHOD_MEAN: PoolingMethod.MEAN,
            worker_pb2.POOLING_METHOD_CLS: PoolingMethod.CLS,
            worker_pb2.POOLING_METHOD_MAX: PoolingMethod.MAX,
        }
        self._normalization_map = {
            worker_pb2.NORMALIZATION_METHOD_NONE: NormalizationMethod.NONE,
            worker_pb2.NORMALIZATION_METHOD_L2: NormalizationMethod.L2,
        }
        self._pooling_reverse = {v: k for k, v in self._pooling_map.items()}
        self._normalization_reverse = {v: k for k, v in self._normalization_map.items()}

    def _resolve_options(
        self,
        options: worker_pb2.EmbedOptions,
        defaults: worker_pb2.EmbedOptions | None = None,
    ) -> tuple[PoolingMethod, NormalizationMethod]:
        pooling = self.default_pooling
        normalization = self.default_normalization

        if defaults is not None:
            if defaults.pooling != worker_pb2.POOLING_METHOD_UNSPECIFIED:
                if defaults.pooling not in self._pooling_map:
                    raise ValueError("Unknown pooling method in defaults")
                pooling = self._pooling_map[defaults.pooling]
            if defaults.normalization != worker_pb2.NORMALIZATION_METHOD_UNSPECIFIED:
                if defaults.normalization not in self._normalization_map:
                    raise ValueError("Unknown normalization method in defaults")
                normalization = self._normalization_map[defaults.normalization]

        if options.pooling != worker_pb2.POOLING_METHOD_UNSPECIFIED:
            if options.pooling not in self._pooling_map:
                raise ValueError("Unknown pooling method in request")
            pooling = self._pooling_map[options.pooling]
        if options.normalization != worker_pb2.NORMALIZATION_METHOD_UNSPECIFIED:
            if options.normalization not in self._normalization_map:
                raise ValueError("Unknown normalization method in request")
            normalization = self._normalization_map[options.normalization]

        if pooling not in self.supported_pooling:
            raise ValueError(f"Pooling method '{pooling.value}' is not supported for this model")
        if normalization not in self.supported_normalization:
            raise ValueError(f"Normalization method '{normalization.value}' is not supported for this model")

        return pooling, normalization
        
    def Embed(self, request: worker_pb2.EmbedRequest, context) -> worker_pb2.EmbedResponse:
        """Handle single embedding request."""
        if not self.ready_event.is_set():
            context.abort(grpc.StatusCode.UNAVAILABLE, "Model is not ready")

        start_time = time.time()
        logger.info(
            "Processing Embed request",
            text_length=len(request.text),
            request_id=request.request_id or "auto",
        )

        try:
            options = request.options if request.HasField("options") else worker_pb2.EmbedOptions()
            pooling, normalization = self._resolve_options(options)

            embedding_request = EmbeddingRequest(
                text=request.text,
                request_id=request.request_id or str(time.time_ns()),
                pooling=pooling,
                normalization=normalization,
                max_sequence_length=self.default_max_sequence_length,
            )

            result = self.engine.embed(embedding_request)
        except ValueError as exc:
            logger.warning("Invalid embed request", error=str(exc))
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))

        logger.info(
            "Embed request completed",
            request_id=result.request_id,
            processing_time_ms=(time.time() - start_time) * 1000,
        )

        return worker_pb2.EmbedResponse(
            request_id=result.request_id,
            embedding=result.embedding,
            model_info=worker_pb2.ModelInfo(
                model_id=result.model_info["model_id"],
                embedding_dimension=result.model_info["embedding_dimension"],
                max_sequence_length=result.model_info["max_sequence_length"],
                default_pooling=self._pooling_reverse[self.default_pooling],
                default_normalization=self._normalization_reverse[self.default_normalization],
                supported_pooling=[self._pooling_reverse[p] for p in self.supported_pooling],
                supported_normalization=[self._normalization_reverse[n] for n in self.supported_normalization],
                device=self.engine.model_loader.model_info.device,
                dtype=self.engine.model_loader.model_info.dtype,
            ),
            tokens=result.tokens,
        )
    
    def EmbedBatch(self, request: worker_pb2.EmbedBatchRequest, context) -> worker_pb2.EmbedBatchResponse:
        """Handle batch embedding request."""
        if not self.ready_event.is_set():
            context.abort(grpc.StatusCode.UNAVAILABLE, "Model is not ready")

        start_time = time.time()
        logger.info("Processing EmbedBatch request", batch_size=len(request.items))

        try:
            defaults = request.defaults if request.HasField("defaults") else None

            embedding_requests = []
            for item in request.items:
                pooling, normalization = self._resolve_options(worker_pb2.EmbedOptions(), defaults)
                embedding_requests.append(
                    EmbeddingRequest(
                        text=item.text,
                        request_id=item.request_id or str(time.time_ns()),
                        pooling=pooling,
                        normalization=normalization,
                        max_sequence_length=self.default_max_sequence_length,
                    )
                )

            results = self.engine.embed_batch(embedding_requests)
        except ValueError as exc:
            logger.warning("Invalid embed batch request", error=str(exc))
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))

        logger.info(
            "EmbedBatch request completed",
            batch_size=len(request.items),
            processing_time_ms=(time.time() - start_time) * 1000,
        )

        response = worker_pb2.EmbedBatchResponse()
        for result in results:
            response.embeddings.append(
                worker_pb2.EmbedResponse(
                    request_id=result.request_id,
                    embedding=result.embedding,
                    model_info=worker_pb2.ModelInfo(
                        model_id=result.model_info["model_id"],
                        embedding_dimension=result.model_info["embedding_dimension"],
                        max_sequence_length=result.model_info["max_sequence_length"],
                        default_pooling=self._pooling_reverse[self.default_pooling],
                        default_normalization=self._normalization_reverse[self.default_normalization],
                        supported_pooling=[self._pooling_reverse[p] for p in self.supported_pooling],
                        supported_normalization=[self._normalization_reverse[n] for n in self.supported_normalization],
                        device=self.engine.model_loader.model_info.device,
                        dtype=self.engine.model_loader.model_info.dtype,
                    ),
                    tokens=result.tokens,
                )
            )

        return response
    
    def HealthCheck(self, request: worker_pb2.HealthCheckRequest, context) -> worker_pb2.HealthCheckResponse:
        """Handle health check request."""
        return worker_pb2.HealthCheckResponse(
            healthy=self.ready_event.is_set(),
            status="OK" if self.ready_event.is_set() else "NOT_READY",
            uptime_seconds=int(time.time() - self.start_time),
        )
    
    def GetModelInfo(self, request: worker_pb2.ModelInfoRequest, context) -> worker_pb2.ModelInfoResponse:
        """Handle model info request."""
        model_info = self.engine.model_loader.model_info

        return worker_pb2.ModelInfoResponse(
            model_info=worker_pb2.ModelInfo(
                model_id=model_info.model_id,
                embedding_dimension=model_info.embedding_dimension,
                max_sequence_length=model_info.max_sequence_length,
                default_pooling=self._pooling_reverse[self.default_pooling],
                default_normalization=self._normalization_reverse[self.default_normalization],
                supported_pooling=[self._pooling_reverse[p] for p in self.supported_pooling],
                supported_normalization=[self._normalization_reverse[n] for n in self.supported_normalization],
                device=model_info.device,
                dtype=model_info.dtype,
            )
        )


def serve() -> None:
    """Start the gRPC server."""
    # Configure logging
    configure_logging()
    
    # Get configuration
    config = get_config()
    
    logger.info("Starting embedding worker", config=config.model_dump())
    
    # Initialize model registry and defaults
    registry = ModelRegistry.load(config.config_path)
    profile = registry.get_profile(
        model_id=config.model_id,
        pooling_override=config.pooling_method,
        normalization_override=config.normalization_method,
        max_sequence_length_override=config.max_sequence_length,
    )

    default_pooling = PoolingMethod(profile.default_pooling)
    default_normalization = NormalizationMethod(profile.default_normalization)
    supported_pooling = [PoolingMethod(value) for value in profile.supported_pooling]
    supported_normalization = [NormalizationMethod(value) for value in profile.supported_normalization]

    # Initialize model
    model_loader = ModelLoader(
        model_id=config.model_id,
        device=config.device,
        dtype=config.dtype,
        cache_dir=config.model_cache_dir,
        revision=config.revision,
        trust_remote_code=config.trust_remote_code,
    )
    
    model_info = model_loader.load(
        default_pooling=profile.default_pooling,
        default_normalization=profile.default_normalization,
        supported_pooling=profile.supported_pooling,
        supported_normalization=profile.supported_normalization,
        max_sequence_length_override=profile.max_sequence_length,
    )
    
    # Initialize engine
    engine = EmbeddingEngine(model_loader)

    ready_event = threading.Event()
    
    # Create gRPC server
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=config.grpc_max_workers),
        options=[
            ("grpc.max_send_message_length", config.grpc_max_message_length),
            ("grpc.max_receive_message_length", config.grpc_max_message_length),
        ],
    )
    
    stop_event = threading.Event()

    def handle_signal(signum, _frame) -> None:
        logger.info("Shutdown signal received", signal=signum)
        stop_event.set()
        server.stop(grace=5)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    # Add servicer
    worker_pb2_grpc.add_WorkerServiceServicer_to_server(
        WorkerServicer(
            engine,
            default_pooling=default_pooling,
            default_normalization=default_normalization,
            default_max_sequence_length=profile.max_sequence_length,
            supported_pooling=supported_pooling,
            supported_normalization=supported_normalization,
            ready_event=ready_event,
        ),
        server,
    )
    
    # Start server
    server.add_insecure_port(f"{config.grpc_host}:{config.grpc_port}")
    server.start()

    if config.warmup_on_start:
        def _warmup() -> None:
            try:
                engine.warmup(config.warmup_texts)
            finally:
                ready_event.set()

        threading.Thread(target=_warmup, daemon=True).start()
    else:
        ready_event.set()
    
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
    finally:
        logger.info("Shutting down server")
        server.stop(0)
        model_loader.unload()
        logger.info("Server shutdown complete")


if __name__ == "__main__":
    serve()
