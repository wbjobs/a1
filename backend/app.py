import os
import uuid
import tempfile
import numpy as np
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from werkzeug.utils import secure_filename

from room_manager import room_manager, MFCC_DIMENSION

app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')
app.config['SECRET_KEY'] = 'voiceprint-secret-key-2024'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'rooms': room_manager.list_rooms(),
        'mfcc_dimension': MFCC_DIMENSION
    })

@app.route('/api/rooms', methods=['GET'])
def list_rooms():
    return jsonify({
        'success': True,
        'rooms': room_manager.list_rooms()
    })

@app.route('/api/rooms/<room_id>/users', methods=['GET'])
def list_room_users(room_id):
    room = room_manager.get_room(room_id)
    if not room:
        return jsonify({'success': False, 'error': 'Room not found'}), 404
    return jsonify({
        'success': True,
        'users': room.list_users(),
        'connected_users': room.list_connected_users()
    })

@app.route('/api/register', methods=['POST'])
def register_user():
    try:
        room_id = request.form.get('room_id')
        user_name = request.form.get('user_name')
        email = request.form.get('email', '')
        
        if not room_id or not user_name:
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
        audio_files = []
        for i in range(1, 4):
            file_key = f'audio_{i}'
            if file_key not in request.files:
                return jsonify({'success': False, 'error': f'Missing audio sample {i}'}), 400
            
            file = request.files[file_key]
            if file.filename == '':
                return jsonify({'success': False, 'error': f'Empty audio sample {i}'}), 400
            
            temp_dir = tempfile.mkdtemp()
            filename = secure_filename(f'sample_{i}.wav')
            filepath = os.path.join(temp_dir, filename)
            file.save(filepath)
            audio_files.append(filepath)
        
        user_id = str(uuid.uuid4())
        room = room_manager.get_or_create_room(room_id)
        
        success = room.add_user(user_id, user_name, email, audio_files)
        
        if success:
            return jsonify({
                'success': True,
                'user_id': user_id,
                'user_name': user_name,
                'room_id': room_id,
                'message': 'Voiceprint registered successfully'
            })
        else:
            return jsonify({'success': False, 'error': 'Failed to process audio samples'}), 500
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/rooms/<room_id>/reset', methods=['POST'])
def reset_room(room_id):
    room = room_manager.get_room(room_id)
    if not room:
        return jsonify({'success': False, 'error': 'Room not found'}), 404
    room.reset_database()
    return jsonify({'success': True, 'message': 'Room voiceprint database reset'})

@socketio.on('join_call')
def handle_join_call(data):
    room_id = data.get('room_id')
    user_id = data.get('user_id')
    user_name = data.get('user_name', 'Anonymous')
    
    if not room_id or not user_id:
        emit('error', {'message': 'Missing room_id or user_id'})
        return
    
    room = room_manager.get_or_create_room(room_id)
    room.add_client(request.sid, user_id)
    join_room(room_id)
    
    emit('user_joined', {
        'user_id': user_id,
        'user_name': user_name,
        'sid': request.sid
    }, room=room_id)
    
    emit('joined', {
        'success': True,
        'room_id': room_id,
        'user_id': user_id,
        'connected_users': room.list_connected_users()
    })

@socketio.on('leave_call')
def handle_leave_call(data):
    room_id = data.get('room_id')
    user_id = data.get('user_id')
    
    room = room_manager.get_room(room_id)
    if room:
        room.remove_client(request.sid)
        leave_room(room_id)
        
        emit('user_left', {
            'user_id': user_id,
            'sid': request.sid
        }, room=room_id)

@socketio.on('voiceprint_feature')
def handle_voiceprint_feature(data):
    room_id = data.get('room_id')
    user_id = data.get('user_id')
    mfcc_vector = data.get('mfcc')
    waveform = data.get('waveform', [])
    
    if not room_id or not mfcc_vector:
        return
    
    room = room_manager.get_room(room_id)
    if not room:
        return
    
    try:
        mfcc_array = np.array(mfcc_vector, dtype=np.float32)
        
        identified_id, identified_name, similarity = room.identify_speaker(mfcc_array, threshold=0.5)
        all_matches = room.search_similar(mfcc_array, k=5)
        
        response = {
            'sender_id': user_id,
            'identified_id': identified_id,
            'identified_name': identified_name,
            'similarity': similarity,
            'all_matches': [
                {'user_id': uid, 'user_name': uname, 'similarity': sim}
                for uid, uname, sim in all_matches
            ],
            'waveform': waveform[:100] if waveform else [],
            'timestamp': data.get('timestamp', 0)
        }
        
        emit('speaker_identified', response, room=room_id)
    
    except Exception as e:
        print(f"Error processing voiceprint: {e}")

@socketio.on('signal')
def handle_signal(data):
    room_id = data.get('room_id')
    target_sid = data.get('target_sid')
    
    if target_sid:
        emit('signal', {
            'sender_sid': request.sid,
            'data': data.get('data')
        }, to=target_sid)

@socketio.on('disconnect')
def handle_disconnect():
    for room_id, room in room_manager.rooms.items():
        user_id = room.get_user_by_sid(request.sid)
        if user_id:
            room.remove_client(request.sid)
            emit('user_left', {
                'user_id': user_id,
                'sid': request.sid
            }, room=room_id)
            break

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
