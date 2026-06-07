import os
import json
import shutil
import numpy as np
import soundfile as sf
from typing import Dict, List, Optional, Tuple, Any
from voiceprint_db import VoiceprintDatabase

USE_LIBROSA = False

def librosa_feature_mfcc(y, sr, n_mfcc=13):
    return fallback_mfcc(y, sr, n_mfcc)

def fallback_mfcc(y, sr, n_mfcc=13, n_fft=2048, hop_length=512):
    import math
    n_mels = 40
    
    def freq_to_mel(freq):
        return 2595 * math.log10(1 + freq / 700)
    
    def mel_to_freq(mel):
        return 700 * (10 ** (mel / 2595) - 1)
    
    def dct(signal, n_mfcc):
        n = len(signal)
        result = []
        for k in range(n_mfcc):
            s = 0.0
            for i in range(n):
                s += signal[i] * math.cos(math.pi * k * (i + 0.5) / n)
            if k == 0:
                s *= math.sqrt(1.0 / n)
            else:
                s *= math.sqrt(2.0 / n)
            result.append(s)
        return result
    
    def hamming_window(n):
        return [0.54 - 0.46 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]
    
    def stft(y, n_fft, hop_length):
        window = hamming_window(n_fft)
        n_frames = (len(y) - n_fft) // hop_length + 1
        spec = []
        for i in range(n_frames):
            frame = y[i * hop_length:i * hop_length + n_fft]
            if len(frame) < n_fft:
                frame = np.pad(frame, (0, n_fft - len(frame)))
            windowed = frame * window
            fft = np.fft.rfft(windowed)
            spec.append(np.abs(fft) ** 2)
        return np.array(spec).T
    
    mel_min = freq_to_mel(0)
    mel_max = freq_to_mel(sr / 2)
    mel_points = np.linspace(mel_min, mel_max, n_mels + 2)
    freq_points = np.array([mel_to_freq(m) for m in mel_points])
    bin_points = np.floor((n_fft + 1) * freq_points / sr).astype(int)
    
    filters = np.zeros((n_mels, n_fft // 2 + 1))
    for i in range(1, n_mels + 1):
        left = bin_points[i - 1]
        center = bin_points[i]
        right = bin_points[i + 1]
        for j in range(left, center):
            filters[i - 1, j] = (j - left) / (center - left)
        for j in range(center, right):
            filters[i - 1, j] = (right - j) / (right - center)
    
    spec = stft(y, n_fft, hop_length)
    mel_spec = np.dot(filters, spec)
    log_mel = np.log(np.maximum(mel_spec, 1e-10))
    
    mfccs = []
    for i in range(log_mel.shape[1]):
        mfccs.append(dct(log_mel[:, i], n_mfcc))
    
    return np.array(mfccs).T

MFCC_DIMENSION = 13
DELTA_QUANTIZATION_BITS = 8
DELTA_THRESHOLD = 0.01
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
        self.whitelist: List[str] = []
        self.whitelist_enabled: bool = False
        self.host_user_id: Optional[str] = None
        self._last_vectors: Dict[str, np.ndarray] = {}
        self._history: List[Dict[str, Any]] = []
        self._max_history = 1000
        
        db_path = os.path.join(VOICEPRINTS_DIR, f'{room_id}.pkl')
        self.voiceprint_db.load(db_path)
        self._load_whitelist()
    
    def add_user(self, user_id: str, user_name: str, email: str, audio_paths: List[str]) -> bool:
        try:
            all_mfccs = []
            
            for audio_path in audio_paths:
                if not os.path.exists(audio_path):
                    continue
                y, sr = sf.read(audio_path)
                if y.ndim > 1:
                    y = y.mean(axis=1)
                mfccs = librosa_feature_mfcc(y=y, sr=sr, n_mfcc=MFCC_DIMENSION)
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
                    shutil.move(audio_path, dest_path)
            
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
    
    def set_host(self, user_id: str) -> None:
        self.host_user_id = user_id
    
    def is_host(self, user_id: str) -> bool:
        return self.host_user_id == user_id
    
    def add_to_whitelist(self, user_id: str) -> bool:
        if user_id in self.users and user_id not in self.whitelist:
            self.whitelist.append(user_id)
            self._save_whitelist()
            return True
        return False
    
    def remove_from_whitelist(self, user_id: str) -> bool:
        if user_id in self.whitelist:
            self.whitelist.remove(user_id)
            self._save_whitelist()
            return True
        return False
    
    def set_whitelist_enabled(self, enabled: bool) -> None:
        self.whitelist_enabled = enabled
        self._save_whitelist()
    
    def is_whitelisted(self, user_id: Optional[str]) -> bool:
        if not self.whitelist_enabled:
            return True
        if user_id is None:
            return False
        return user_id in self.whitelist
    
    def get_whitelist(self) -> List[Dict[str, Any]]:
        return [
            {
                'user_id': uid,
                'user_name': self.users.get(uid, {}).get('user_name', 'Unknown'),
                'enabled': True
            }
            for uid in self.whitelist
        ]
    
    def _save_whitelist(self) -> None:
        data = {
            'whitelist': self.whitelist,
            'whitelist_enabled': self.whitelist_enabled,
            'host_user_id': self.host_user_id
        }
        whitelist_path = os.path.join(VOICEPRINTS_DIR, f'{self.room_id}_whitelist.json')
        with open(whitelist_path, 'w') as f:
            json.dump(data, f)
    
    def _load_whitelist(self) -> None:
        whitelist_path = os.path.join(VOICEPRINTS_DIR, f'{self.room_id}_whitelist.json')
        if os.path.exists(whitelist_path):
            try:
                with open(whitelist_path, 'r') as f:
                    data = json.load(f)
                self.whitelist = data.get('whitelist', [])
                self.whitelist_enabled = data.get('whitelist_enabled', False)
                self.host_user_id = data.get('host_user_id')
            except Exception as e:
                print(f"Error loading whitelist for room {self.room_id}: {e}")
    
    def decode_delta_vector(self, user_id: str, delta_data: Dict[str, Any]) -> np.ndarray:
        is_keyframe = delta_data.get('is_keyframe', False)
        delta = np.array(delta_data.get('delta', []), dtype=np.float32)
        
        if is_keyframe or user_id not in self._last_vectors:
            reconstructed = delta.copy()
        else:
            last_vector = self._last_vectors[user_id]
            reconstructed = last_vector + delta
        
        self._last_vectors[user_id] = reconstructed.copy()
        return reconstructed
    
    def identify_with_delta(self, user_id: str, delta_data: Dict[str, Any], 
                           threshold: float = 0.5) -> Tuple[Optional[str], Optional[str], float, bool]:
        mfcc_vector = self.decode_delta_vector(user_id, delta_data)
        identified_id, identified_name, similarity = self.identify_speaker(mfcc_vector, threshold)
        is_whitelisted = self.is_whitelisted(identified_id)
        return identified_id, identified_name, similarity, is_whitelisted
    
    def search_with_delta(self, user_id: str, delta_data: Dict[str, Any], 
                         k: int = 5) -> List[Tuple[str, str, float, bool]]:
        mfcc_vector = self.decode_delta_vector(user_id, delta_data)
        results = self.search_similar(mfcc_vector, k)
        return [
            (uid, uname, sim, self.is_whitelisted(uid))
            for uid, uname, sim in results
        ]
    
    def add_to_history(self, record: Dict[str, Any]) -> None:
        self._history.append(record)
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]
    
    def get_history(self, start_time: Optional[float] = None, 
                   end_time: Optional[float] = None) -> List[Dict[str, Any]]:
        if start_time is None and end_time is None:
            return self._history.copy()
        
        filtered = []
        for record in self._history:
            ts = record.get('timestamp', 0)
            if start_time is not None and ts < start_time:
                continue
            if end_time is not None and ts > end_time:
                continue
            filtered.append(record)
        return filtered
    
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
