from sentence_transformers import SentenceTransformer
import numpy as np


def embed_chunks(chunks: list, prompt_type: str = "classification") -> np.ndarray:
    model = SentenceTransformer("ai-forever/ru-en-RoSBERTa")
    embeddings = model.encode(chunks, prompt_name=prompt_type)
    
    return embeddings

