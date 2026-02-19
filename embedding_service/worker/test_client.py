"""Test client for the embedding worker."""
import grpc
import time

from worker.v1 import worker_pb2, worker_pb2_grpc


def test_health_check():
    """Test health check endpoint."""
    print("Testing health check...")
    
    with grpc.insecure_channel("localhost:50051") as channel:
        stub = worker_pb2_grpc.WorkerServiceStub(channel)
        
        response = stub.HealthCheck(worker_pb2.HealthCheckRequest())
        print(f"Health check response: {response}")
        
        if response.healthy:
            print("✓ Health check passed")
        else:
            print("✗ Health check failed")
        
        return response.healthy


def test_model_info():
    """Test model info endpoint."""
    print("\nTesting model info...")
    
    with grpc.insecure_channel("localhost:50051") as channel:
        stub = worker_pb2_grpc.WorkerServiceStub(channel)
        
        response = stub.GetModelInfo(worker_pb2.ModelInfoRequest())
        print(f"Model info response: {response}")
        print(f"✓ Model: {response.model_info.model_id}")
        print(f"✓ Embedding dimension: {response.model_info.embedding_dimension}")
        print(f"✓ Max sequence length: {response.model_info.max_sequence_length}")
        
        return response


def test_single_embedding():
    """Test single embedding endpoint."""
    print("\nTesting single embedding...")
    
    with grpc.insecure_channel("localhost:50051") as channel:
        stub = worker_pb2_grpc.WorkerServiceStub(channel)
        
        request = worker_pb2.EmbedRequest(
            text="This is a test sentence for embedding generation.",
            options=worker_pb2.EmbedOptions(
                normalization=worker_pb2.NORMALIZATION_METHOD_L2,
            ),
        )
        
        start_time = time.time()
        response = stub.Embed(request)
        elapsed = (time.time() - start_time) * 1000
        
        print(f"Embedding response time: {elapsed:.2f}ms")
        print(f"✓ Embedding dimension: {len(response.embedding)}")
        print(f"✓ Tokens used: {response.tokens}")
        print(f"✓ Model: {response.model_info.model_id}")
        
        # Verify embedding is normalized
        import numpy as np
        embedding_np = np.array(response.embedding)
        norm = np.linalg.norm(embedding_np)
        print(f"✓ Embedding norm: {norm:.6f} (should be ~1.0 for normalized)")
        
        return response


def test_batch_embedding():
    """Test batch embedding endpoint."""
    print("\nTesting batch embedding...")
    
    with grpc.insecure_channel("localhost:50051") as channel:
        stub = worker_pb2_grpc.WorkerServiceStub(channel)
        
        texts = [
            "First test sentence.",
            "Second test sentence with more words.",
            "Third test sentence for batch processing.",
            "Fourth sentence to test batching capabilities.",
            "Fifth and final test sentence.",
        ]
        
        request = worker_pb2.EmbedBatchRequest(
            items=[worker_pb2.EmbedItem(text=text) for text in texts],
            defaults=worker_pb2.EmbedOptions(
                normalization=worker_pb2.NORMALIZATION_METHOD_L2,
            ),
        )
        
        start_time = time.time()
        response = stub.EmbedBatch(request)
        elapsed = (time.time() - start_time) * 1000
        
        print(f"Batch embedding response time: {elapsed:.2f}ms")
        print(f"✓ Number of embeddings: {len(response.embeddings)}")
        print(f"✓ Batch size: {len(texts)}")
        
        # Verify all embeddings
        import numpy as np
        for i, embedding_response in enumerate(response.embeddings):
            embedding_np = np.array(embedding_response.embedding)
            norm = np.linalg.norm(embedding_np)
            print(f"  Embedding {i+1}: {len(embedding_response.embedding)} dim, norm: {norm:.6f}")
        
        return response


def main():
    """Run all tests."""
    print("=== Embedding Worker Test Client ===\n")
    
    try:
        # Wait for server to be ready
        print("Waiting for server to be ready...")
        time.sleep(5)
        
        # Run tests
        if not test_health_check():
            print("\n✗ Server is not healthy. Exiting.")
            return
        
        test_model_info()
        test_single_embedding()
        test_batch_embedding()
        
        print("\n=== All tests completed successfully! ===")
        
    except grpc.RpcError as e:
        print(f"\n✗ gRPC error: {e}")
        print(f"Details: {e.details()}")
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
