import logging
import uuid
from typing import Optional

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qdrant_models
from qdrant_client.models import Distance, PointStruct, VectorParams

logger = logging.getLogger(__name__)


class QdrantRepository:
    def __init__(self, url: str, api_key: Optional[str] = None):
        self._client = AsyncQdrantClient(url=url, api_key=api_key, check_compatibility=False)

    async def ensure_collection(
        self,
        collection_name: str,
        vector_size: int,
        sparse_enabled: bool = True,
        on_disk_payload: bool = True,
        distance: Distance = Distance.COSINE,
    ) -> None:
        try:
            info = await self._client.get_collection(collection_name)
            existing_size = info.config.params.vectors["dense"].size
            if existing_size == vector_size:
                logger.info("Qdrant collection already exists", extra={"collection": collection_name})
                return
            logger.warning(
                "Qdrant collection dimension mismatch, recreating",
                extra={"collection": collection_name, "existing": existing_size, "expected": vector_size},
            )
            await self._client.delete_collection(collection_name)
        except Exception:
            pass

        vectors_config = {
            "dense": VectorParams(size=vector_size, distance=distance, on_disk=True),
        }
        sparse_vectors_config = None
        if sparse_enabled:
            sparse_vectors_config = {"sparse": qdrant_models.SparseVectorParams()}

        await self._client.create_collection(
            collection_name=collection_name,
            vectors_config=vectors_config,
            sparse_vectors_config=sparse_vectors_config,
            on_disk_payload=on_disk_payload,
        )
        logger.info("Qdrant collection created", extra={"collection": collection_name})

    async def upsert_chunks(
        self,
        collection_name: str,
        chunk_ids: list[int],
        dense_vectors: list[list[float]],
        sparse_vectors: Optional[list[dict]] = None,
        payloads: Optional[list[dict]] = None,
    ) -> list[uuid.UUID]:
        point_ids = [uuid.uuid4() for _ in chunk_ids]
        assert len(chunk_ids) == len(dense_vectors)

        points = []
        for i, cid in enumerate(chunk_ids):
            vector_entry = {"dense": dense_vectors[i]}
            if sparse_vectors and sparse_vectors[i] and sparse_vectors[i].get("indices"):
                vector_entry["sparse"] = sparse_vectors[i]
            points.append(PointStruct(id=str(point_ids[i]), vector=vector_entry, payload=payloads[i] if payloads else None))

        await self._client.upsert(collection_name=collection_name, points=points)
        return point_ids

    async def search_hybrid(
        self,
        collection_name: str,
        query_vector: list[float],
        sparse_vector: Optional[dict] = None,
        dense_weight: float = 0.7,
        sparse_weight: float = 0.3,
        limit: int = 5,
        filter_condition: Optional[qdrant_models.Filter] = None,
    ) -> list[dict]:
        prefetch = []
        prefetch.append(
            qdrant_models.Prefetch(
                query=query_vector,
                using="dense",
                limit=limit * 2,
            )
        )
        if sparse_vector:
            prefetch.append(
                qdrant_models.Prefetch(
                    query=sparse_vector,
                    using="sparse",
                    limit=limit * 2,
                )
            )

        results = await self._client.query_points(
            collection_name=collection_name,
            prefetch=prefetch,
            query=qdrant_models.FusionQuery(fusion=qdrant_models.Fusion.RRF),
            query_filter=filter_condition,
            limit=limit,
        )

        return [
            {
                "point_id": r.id,
                "score": r.score,
                "payload": r.payload or {},
            }
            for r in results.points
        ]

    async def search_dense(
        self,
        collection_name: str,
        query_vector: list[float],
        limit: int = 5,
        score_threshold: Optional[float] = None,
        filter_condition: Optional[qdrant_models.Filter] = None,
    ) -> list[dict]:
        results = await self._client.query_points(
            collection_name=collection_name,
            query=query_vector,
            using="dense",
            limit=limit,
            score_threshold=score_threshold,
            query_filter=filter_condition,
            with_payload=True,
        )

        return [
            {
                "point_id": str(r.id) if r.id else "",
                "score": r.score,
                "payload": r.payload or {},
            }
            for r in results.points
        ]

    async def delete_by_filter(
        self, collection_name: str, filter_condition: qdrant_models.Filter
    ) -> None:
        await self._client.delete(
            collection_name=collection_name,
            points_selector=qdrant_models.FilterSelector(filter=filter_condition),
        )

    async def health_check(self) -> bool:
        try:
            collections = await self._client.get_collections()
            return collections is not None
        except Exception:
            return False
