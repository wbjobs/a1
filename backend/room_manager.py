import os
import numpy as np
import librosa
import soundfile as sf
from typing import Dict, List, Optional, Tuple, Any
from voiceprint_db import VoiceprintDatabase

MFCC_DIMENSION = 13
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
AUDIO_SAMPLES_DIR = os.path.join(DATA_DIR, 'audio_samples')
VOICEPRINTS_DIR = os.path.join(DATA_DIR, 'voiceprints')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(AUDIO_SAMPLES_DIR, exist_ok=True)
os.makedirs(VOICEPRINTS_DIR, exist_ok=True)

class Room:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.voiceprint_db = VoiceprintDatabase(dimension=MFCC_DIMENSION)
        self.users: Dict[str, Dict[str, Any]] = {}
        self.connected_clients: Dict[str, str] = {}
        
        db_path = os.path.join(VOICEPRINTS_DIR, f'{room_id}.pkl')
        self.voiceprint_db.load(db_path)
    
    def add_user(self, user_id: str, user_name: str, email: str, audio_paths: List[str]) -> bool:
        try:
            all_mfccs = []
            
            for audio_path in audio_paths:
                if not os.path.exists(audio_path):
                    continue
                y, sr = sf.read(audio_path)
                if y.ndim > 1:
                    y = y.mean(axis=1)
                mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=MFCC_DIMENSION)
                mfccs = mfccs.T
                all_mfccs.append(mfccs)
            
            if not all_mfccs:
                return False
            
            combined_mfccs = np.vstack(all_mfccs)
            self.voiceprint_db.add_vectors(user_id, user_name, combined_mfccs)
            
            user_audio_dir = os.path.join(AUDIO_SAMPLES_DIR, self.room_id, user_id)
            os.makedirs(user_audio_dir, exist_ok=True)
            
            for i, audio_path in enumerate(audio_paths):
                if os.path.exists(audio_path):
                    dest_path = os.path.join(user_audio_dir, f'sample_{i+1}.wav')
                    os.rename(audio_path, dest_path)
            
            self.users[user_id] = {
                'user_id': user_id,
                'user_name': user_name,
                'email': email,
                'registered': True
            }
            
            self._save_database()
            return True
        except Exception as e:
            print(f"Error adding user {user_id} to room {self.room_id}: {e}")
            return False
    
    def identify_speaker(self, mfcc_vector: np.ndarray, threshold: float = 0.5) -> Tuple[Optional[str], Optional[str], float]:
        return self.voiceprint_db.identify(mfcc_vector, threshold)
    
    def search_similar(self, mfcc_vector: np.ndarray, k: int = 5) -> List[Tuple[str, str, float]]:
        return self.voiceprint_db.search(mfcc_vector, k)
    
    def add_client(self, client_sid: str, user_id: str) -> None:
        self.connected_clients[client_sid] = user_id
    
    def remove_client(self, client_sid: str) -> None:
        if client_sid in self.connected_clients:
            del self.connected_clients[client_sid]
    
    def get_user_by_sid(self, client_sid: str) -> Optional[str]:
        return self.connected_clients.get(client_sid)
    
    def list_users(self) -> List[Dict[str, Any]]:
        return list(self.users.values())
    
    def list_connected_users(self) -> List[str]:
        return list(self.connected_clients.values())
    
    def get_user_count(self) -> int:
        return len(self.users)
    
    def _save_database(self) -> None:
        db_path = os.path.join(VOICEPRINTS_DIR, f'{self.room_id}.pkl')
        self.voiceprint_db.save(db_path)
    
    def reset_database(self) -> None:
        self.voiceprint_db.reset()
        db_path = os.path.join(VOICEPRINTS_DIR, f'{self.room_id}.pkl')
        if os.path.exists(db_path):
            os.remove(db_path)
        self.users.clear()

class RoomManager:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}
        self._load_existing_rooms()
    
    def _load_existing_rooms(self) -> None:
        for filename in os.listdir(VOICEPRINTS_DIR):
            if filename.endswith('.pkl'):
                room_id = filename[:-4]
                self.rooms[room_id] = Room(room_id)
    
    def get_or_create_room(self, room_id: str) -> Room:
        if room_id not in self.rooms:
            self.rooms[room_id] = Room(room_id)
        return self.rooms[room_id]
    
    def get_room(self, room_id: str) -> Optional[Room]:
        return self.rooms.get(room_id)
    
    def remove_room(self, room_id: str) -> bool:
        if room_id in self.rooms:
            self.rooms[room_id].reset_database()
            del self.rooms[room_id]
            return True
        return False
    
    def list_rooms(self) -> List[Dict[str, Any]]:
        return [
            {
                'room_id': room_id,
                'user_count': room.get_user_count(),
                'connected_count': len(room.connected_clients)
            }
            for room_id, room in self.rooms.items()
        ]

room_manager = RoomManager()
