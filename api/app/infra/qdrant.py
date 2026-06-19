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
                await self._ensure_payload_indexes(collection_name)
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
        await self._ensure_payload_indexes(collection_name)
        logger.info("Qdrant collection created", extra={"collection": collection_name})

    async def _ensure_payload_indexes(self, collection_name: str) -> None:
        for field_name in (
            "chunk_id",
            "chunk_order",
            "document_id",
            "project_id",
            "index_config_id",
            "char_start",
            "char_end",
            "char_count",
        ):
            try:
                await self._client.create_payload_index(
                    collection_name=collection_name,
                    field_name=field_name,
                    field_schema=qdrant_models.PayloadSchemaType.INTEGER,
                )
            except Exception:
                logger.debug(
                    "Qdrant payload index already exists or could not be created",
                    extra={"collection": collection_name, "field": field_name},
                )

    async def upsert_chunks(
        self,
        collection_name: str,
        chunk_ids: list[int],
        dense_vectors: list[list[float]],
        sparse_vectors: Optional[list[dict]] = None,
        payloads: Optional[list[dict]] = None,
        point_ids: Optional[list[uuid.UUID]] = None,
    ) -> list[uuid.UUID]:
        if point_ids is None:
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
        mode = self.resolve_retrieval_mode(dense_weight, sparse_weight, sparse_vector)
        if mode == "sparse":
            points = await self._client.query_points(
                collection_name=collection_name,
                query=sparse_vector,
                using="sparse",
                limit=limit,
                query_filter=filter_condition,
                with_payload=True,
            )
            return self._format_query_points(points.points)

        if mode == "dense":
            return await self.search_dense(
                collection_name=collection_name,
                query_vector=query_vector,
                limit=limit,
                filter_condition=filter_condition,
            )

        fetch_limit = max(limit * 2, limit)
        points = await self._client.query_points(
            collection_name=collection_name,
            prefetch=[
                qdrant_models.Prefetch(
                    query=query_vector,
                    using="dense",
                    limit=fetch_limit,
                    filter=filter_condition,
                ),
                qdrant_models.Prefetch(
                    query=sparse_vector,
                    using="sparse",
                    limit=fetch_limit,
                    filter=filter_condition,
                ),
            ],
            query=self._weighted_rrf_query(dense_weight, sparse_weight),
            limit=limit,
            with_payload=True,
        )
        return self._format_query_points(points.points)

    async def search_similar_hybrid_by_point(
        self,
        collection_name: str,
        positive_point_id: uuid.UUID,
        sparse_vector: Optional[dict] = None,
        dense_weight: float = 0.5,
        sparse_weight: float = 0.5,
        limit: int = 5,
        max_distance: Optional[float] = None,
        filter_condition: Optional[qdrant_models.Filter] = None,
    ) -> list[dict]:
        mode = self.resolve_retrieval_mode(dense_weight, sparse_weight, sparse_vector)
        if mode == "sparse":
            points = await self._client.query_points(
                collection_name=collection_name,
                query=sparse_vector,
                using="sparse",
                limit=limit,
                query_filter=filter_condition,
                with_payload=True,
            )
            results = self._format_query_points(points.points)
            return self._filter_by_distance(results, max_distance)[:limit]

        dense_query = qdrant_models.RecommendQuery(
            recommend=qdrant_models.RecommendInput(positive=[positive_point_id])
        )
        if mode == "dense":
            points = await self._client.query_points(
                collection_name=collection_name,
                query=dense_query,
                using="dense",
                limit=limit,
                query_filter=filter_condition,
                with_payload=True,
            )
            results = self._format_query_points(points.points)
            return self._filter_by_distance(results, max_distance)[:limit]

        fetch_limit = max(limit * 2, limit)
        points = await self._client.query_points(
            collection_name=collection_name,
            prefetch=[
                qdrant_models.Prefetch(
                    query=dense_query,
                    using="dense",
                    limit=fetch_limit,
                    filter=filter_condition,
                ),
                qdrant_models.Prefetch(
                    query=sparse_vector,
                    using="sparse",
                    limit=fetch_limit,
                    filter=filter_condition,
                ),
            ],
            query=self._weighted_rrf_query(dense_weight, sparse_weight),
            limit=fetch_limit,
            with_payload=True,
        )
        results = self._format_query_points(points.points)
        return self._filter_by_distance(results, max_distance)[:limit]

    def _weighted_rrf_query(self, dense_weight: float, sparse_weight: float) -> qdrant_models.RrfQuery:
        return qdrant_models.RrfQuery(
            rrf=qdrant_models.Rrf(weights=[float(dense_weight), float(sparse_weight)])
        )

    def resolve_retrieval_mode(
        self,
        dense_weight: float,
        sparse_weight: float,
        sparse_vector: Optional[dict],
    ) -> str:
        has_dense = dense_weight > 0
        has_sparse = sparse_weight > 0 and self._has_sparse_vector(sparse_vector)
        if has_dense and has_sparse:
            return "hybrid"
        if has_sparse:
            return "sparse"
        return "dense"

    def _has_sparse_vector(self, sparse_vector: Optional[dict]) -> bool:
        return bool(sparse_vector and sparse_vector.get("indices") and sparse_vector.get("values"))

    def _format_query_points(self, points: list) -> list[dict]:
        return [
            {
                "point_id": str(point.id) if point.id else "",
                "score": point.score,
                "distance": 1.0 - point.score if point.score is not None else None,
                "payload": point.payload or {},
            }
            for point in points
        ]

    def _filter_by_distance(self, results: list[dict], max_distance: Optional[float]) -> list[dict]:
        if max_distance is None:
            return results
        return [
            result
            for result in results
            if result.get("distance") is not None and result["distance"] <= max_distance
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

        return self._format_query_points(results.points)

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
