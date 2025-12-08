from sentence_transformers import SentenceTransformer

def chunk_text(text: str, max_tokens: int = 512, overlap: int = 50) -> list:
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained("ai-forever/ru-en-RoSBERTa")
    
    tokens = tokenizer.encode(text, add_special_tokens=False)
    print(f"Tokens", len(tokens))
    if len(tokens) <= max_tokens:
        return [text]
    
    chunks = []
    start = 0
    
    while start < len(tokens):
        end = min(start + max_tokens, len(tokens))
        
        chunk_tokens = tokens[start:end]
        
        chunk_text = tokenizer.decode(chunk_tokens, skip_special_tokens=True)
        chunks.append(chunk_text)
        
        start += max_tokens - overlap
    
    return chunks
