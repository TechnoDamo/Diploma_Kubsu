import logging
import threading

logger = logging.getLogger(__name__)

_model_lock = threading.Lock()
_model = None


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from fastembed import SparseTextEmbedding

                logger.info("Loading BM25 sparse model (Qdrant/bm25)...")
                _model = SparseTextEmbedding(model_name="Qdrant/bm25")
                logger.info("BM25 sparse model loaded")
    return _model


def generate_sparse_vectors(texts: list[str]) -> list[dict]:
    if not texts:
        return []
    model = _get_model()
    results = list(model.embed(texts))
    return [
        {"indices": v.indices.tolist() if hasattr(v.indices, "tolist") else list(v.indices),
         "values": v.values.tolist() if hasattr(v.values, "tolist") else list(v.values)}
        for v in results
    ]
