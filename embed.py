from sentence_transformers import SentenceTransformer

# loads model with CLS pooling
model = SentenceTransformer("ai-forever/ru-en-RoSBERTa")

classification = model.encode(["Он нам и <unk> не нужон ваш Интернет!", "What a time to be alive!"], prompt_name="classification")
print(classification[0] @ classification[1].T) # 0.47968706488609314

clustering = model.encode(["В Ярославской области разрешили работу бань, но без посетителей", "Ярославским баням разрешили работать без посетителей"], prompt_name="clustering")
print(clustering[0] @ clustering[1].T) # 0.940900444984436

query_embedding = model.encode("Сколько программистов нужно, чтобы вкрутить лампочку?", prompt_name="search_query")
document_embedding = model.encode("Чтобы вкрутить лампочку, требуется три программиста: один напишет программу извлечения лампочки, другой — вкручивания лампочки, а третий проведет тестирование.", prompt_name="search_document")
print(query_embedding @ document_embedding.T) # 0.7761018872261047

print(f"Type: {type(query_embedding)}")  # <class 'numpy.ndarray'>
print(f"Shape: {query_embedding.shape}")  # (1, 768) or similar
print(f"Data type: {query_embedding.dtype}")  # float32
print(f"Vector dimension: {query_embedding.shape[0]}")  # Usually 768 for RoBERTa

