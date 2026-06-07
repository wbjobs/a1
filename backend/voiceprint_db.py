import numpy as np
import faiss
import pickle
import os
from typing import List, Tuple, Optional

class VoiceprintDatabase:
    def __init__(self, dimension: int = 13):
        self.dimension = dimension
        self.index = faiss.IndexFlatL2(dimension)
        self.user_ids: List[str] = []
        self.user_names: List[str] = []
    
    def add_vectors(self, user_id: str, user_name: str, vectors: np.ndarray) -> None:
        if vectors.ndim == 1:
            vectors = vectors.reshape(1, -1)
        
        if vectors.shape[1] != self.dimension:
            raise ValueError(f"Vector dimension mismatch. Expected {self.dimension}, got {vectors.shape[1]}")
        
        vectors = vectors.astype('float32')
        self.index.add(vectors)
        
        for _ in range(vectors.shape[0]):
            self.user_ids.append(user_id)
            self.user_names.append(user_name)
    
    def search(self, query_vector: np.ndarray, k: int = 5) -> List[Tuple[str, str, float]]:
        if self.index.ntotal == 0:
            return []
        
        if query_vector.ndim == 1:
            query_vector = query_vector.reshape(1, -1)
        
        query_vector = query_vector.astype('float32')
        distances, indices = self.index.search(query_vector, min(k, self.index.ntotal))
        
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx >= 0 and idx < len(self.user_ids):
                similarity = 1.0 / (1.0 + dist)
                results.append((
                    self.user_ids[idx],
                    self.user_names[idx],
                    float(similarity)
                ))
        
        return results
    
    def identify(self, query_vector: np.ndarray, threshold: float = 0.5) -> Tuple[Optional[str], Optional[str], float]:
        results = self.search(query_vector, k=1)
        if not results:
            return None, None, 0.0
        
        user_id, user_name, similarity = results[0]
        if similarity >= threshold:
            return user_id, user_name, similarity
        return None, "Unknown", similarity
    
    def save(self, filepath: str) -> None:
        data = {
            'dimension': self.dimension,
            'user_ids': self.user_ids,
            'user_names': self.user_names,
            'index': faiss.serialize_index(self.index)
        }
        with open(filepath, 'wb') as f:
            pickle.dump(data, f)
    
    def load(self, filepath: str) -> None:
        if not os.path.exists(filepath):
            return
        with open(filepath, 'rb') as f:
            data = pickle.load(f)
        self.dimension = data['dimension']
        self.user_ids = data['user_ids']
        self.user_names = data['user_names']
        self.index = faiss.deserialize_index(data['index'])
    
    def reset(self) -> None:
        self.index = faiss.IndexFlatL2(self.dimension)
        self.user_ids = []
        self.user_names = []
    
    def __len__(self) -> int:
        return len(set(self.user_ids))
