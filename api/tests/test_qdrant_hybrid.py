from types import SimpleNamespace

import pytest
from qdrant_client.http import models as qdrant_models

from app.infra.qdrant import QdrantRepository


class FakeQdrantClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def query_points(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            points=[
                SimpleNamespace(id="point-1", score=0.8, payload={"text": "match"}),
            ],
        )


@pytest.mark.asyncio
async def test_search_hybrid_uses_qdrant_prefetch_when_dense_and_sparse_enabled() -> None:
    repo = QdrantRepository(url="http://localhost:6333")
    fake_client = FakeQdrantClient()
    repo._client = fake_client

    results = await repo.search_hybrid(
        collection_name="collection",
        query_vector=[0.1, 0.2],
        sparse_vector={"indices": [1], "values": [0.7]},
        dense_weight=0.7,
        sparse_weight=0.3,
        limit=5,
    )

    call = fake_client.calls[0]
    assert call["query"] == qdrant_models.RrfQuery(rrf=qdrant_models.Rrf(weights=[0.7, 0.3]))
    assert len(call["prefetch"]) == 2
    assert call["prefetch"][0].using == "dense"
    assert call["prefetch"][1].using == "sparse"
    assert results[0]["point_id"] == "point-1"
    assert results[0]["distance"] == pytest.approx(0.2)


@pytest.mark.asyncio
async def test_search_hybrid_uses_sparse_only_when_dense_weight_is_zero() -> None:
    repo = QdrantRepository(url="http://localhost:6333")
    fake_client = FakeQdrantClient()
    repo._client = fake_client

    await repo.search_hybrid(
        collection_name="collection",
        query_vector=[0.1, 0.2],
        sparse_vector={"indices": [1], "values": [0.7]},
        dense_weight=0,
        sparse_weight=1,
        limit=5,
    )

    call = fake_client.calls[0]
    assert "prefetch" not in call
    assert call["using"] == "sparse"


def test_retrieval_mode_falls_back_to_dense_without_sparse_vector() -> None:
    repo = QdrantRepository(url="http://localhost:6333")

    assert repo.resolve_retrieval_mode(0.7, 0.3, None) == "dense"
    assert repo.resolve_retrieval_mode(0, 1, {"indices": [1], "values": [1.0]}) == "sparse"
    assert repo.resolve_retrieval_mode(1, 1, {"indices": [1], "values": [1.0]}) == "hybrid"
