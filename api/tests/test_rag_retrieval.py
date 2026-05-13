from types import SimpleNamespace

import pytest

from app.services.rag import RAGService


class FakeResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class FakeDB:
    def __init__(self):
        self._results = [
            FakeResult(SimpleNamespace(id=166, state="ready")),
            FakeResult(
                SimpleNamespace(
                    embedding_model_name="model",
                    embedding_dimension=2,
                    rag_top_k=10,
                    rag_dense_weight=0.7,
                    rag_sparse_weight=0.3,
                    version=1,
                )
            ),
        ]

    async def execute(self, *_args, **_kwargs):
        return self._results.pop(0)


class FakeTEI:
    async def embed(self, texts, dimension, model):
        assert texts == ["query"]
        assert dimension == 2
        assert model == "model"
        return [[0.1, 0.2]]


class FakeQdrant:
    def __init__(self):
        self.call = None

    def resolve_retrieval_mode(self, dense_weight, sparse_weight, sparse_vector):
        if dense_weight > 0 and sparse_weight > 0 and sparse_vector:
            return "hybrid"
        if sparse_weight > 0 and sparse_vector:
            return "sparse"
        return "dense"

    async def search_hybrid(self, **kwargs):
        self.call = kwargs
        return [
            {
                "point_id": "point-1",
                "score": 0.9,
                "distance": 0.1,
                "payload": {
                    "document_id": 379,
                    "chunk_id": 12,
                    "chunk_order": 11,
                    "char_start": 100,
                    "char_end": 200,
                    "text": "Matched chunk text",
                },
            }
        ]


@pytest.mark.asyncio
async def test_retrieve_points_vectorizes_text_and_returns_structured_points(monkeypatch) -> None:
    qdrant = FakeQdrant()
    service = RAGService(
        db=FakeDB(),
        tei=FakeTEI(),
        llm=SimpleNamespace(),
        qdrant=qdrant,
        settings=SimpleNamespace(
            sparse_vector_enabled=True,
            rag_dense_weight=0.7,
            rag_sparse_weight=0.3,
            rag_retrieval_top_k=5,
            qdrant_collection_name="mimir_project",
        ),
    )

    async def fake_sparse(_text):
        return {"indices": [1], "values": [1.0]}

    monkeypatch.setattr(service, "_generate_query_sparse", fake_sparse)

    result = await service.retrieve_points(
        project_id=166,
        query_text="query",
        target_document_ids=[379],
        dense_weight=0.4,
        sparse_weight=0.6,
        limit=3,
        include_text=False,
        include_payload=False,
    )

    assert result["collection_name"] == "mimir_project_166"
    assert result["retrieval_mode"] == "hybrid"
    assert result["dense_weight"] == 0.4
    assert result["sparse_weight"] == 0.6
    assert qdrant.call["limit"] == 3
    assert qdrant.call["sparse_vector"] == {"indices": [1], "values": [1.0]}
    assert result["points"] == [
        {
            "point_id": "point-1",
            "score": 0.9,
            "distance": 0.1,
            "document_id": 379,
            "chunk_id": 12,
            "chunk_order": 11,
            "char_start": 100,
            "char_end": 200,
            "text_preview": "Matched chunk text",
            "text": None,
            "payload": None,
        }
    ]
