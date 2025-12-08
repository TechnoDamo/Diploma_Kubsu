from sentence_transformers import SentenceTransformer
import numpy as np
from embedding_service.embedder import embed_chunks
from embedding_service.chunker import chunk_text

def embed_text(text: str, max_tokens: int = 500, overlap: int = 50, 
                     prompt_type: str = "classification") -> np.ndarray:
    
    # Step 1: Chunk the text
    print(f"Chunking {len(text):,} characters...")
    chunks = chunk_text(text, max_tokens, overlap)
    print(f"Created {len(chunks)} chunks")
    
    # Step 2: Generate embeddings
    print(f"Generating {prompt_type} embeddings...")
    embeddings = embed_chunks(chunks, prompt_type)
    print(f"Embeddings shape: {embeddings.shape}")
    
    return embeddings
