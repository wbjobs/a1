import { WebRTCClient } from './webrtc.js';
import { MFCCExtractor } from './mfcc.js';
import { SocketClient } from './socket.js';
import { Visualizer } from './visualization.js';
import { AudioRecorder } from './registration.js';

class VoiceprintApp {
    constructor() {
        this.currentView = 'login';
        this.roomId = null;
        this.userId = null;
        this.userName = null;
        
        this.webrtc = null;
        this.mfccExtractor = null;
        this.socket = null;
        this.visualizer = null;
        this.audioRecorder = null;
        
        this.audioEnabled = true;
        this.videoEnabled = true;
        this.analysisEnabled = true;
        
        this.recognitionHistory = [];
        this.heatmapData = [];
        this.connectedUsers = new Map();
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.audioRecorder = new AudioRecorder();
        this.visualizer = new Visualizer();
        this.socket = new SocketClient();
        
        this.setupSocketHandlers();
        this.checkAllSamplesRecorded();
    }
    
    setupEventListeners() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });
        
        document.getElementById('join-btn').addEventListener('click', () => this.joinRoom());
        document.getElementById('register-btn').addEventListener('click', () => this.registerVoiceprint());
        document.getElementById('leave-btn').addEventListener('click', () => this.leaveRoom());
        
        document.querySelectorAll('.record-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sampleNum = parseInt(e.target.dataset.sample);
                this.audioRecorder.recordSample(sampleNum);
            });
        });
        
        document.getElementById('toggle-audio').addEventListener('click', () => this.toggleAudio());
        document.getElementById('toggle-video').addEventListener('click', () => this.toggleVideo());
        document.getElementById('toggle-analysis').addEventListener('click', () => this.toggleAnalysis());
    }
    
    setupSocketHandlers() {
        this.socket.on('speaker_identified', (data) => this.handleSpeakerIdentified(data));
        this.socket.on('user_joined', (data) => this.handleUserJoined(data));
        this.socket.on('user_left', (data) => this.handleUserLeft(data));
        this.socket.on('joined', (data) => this.handleJoined(data));
        this.socket.on('signal', (data) => this.handleSignal(data));
        this.socket.on('error', (data) => console.error('Socket error:', data));
    }
    
    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });
    }
    
    async joinRoom() {
        const roomId = document.getElementById('join-room-id').value.trim();
        const userName = document.getElementById('join-user-name').value.trim();
        const userIdInput = document.getElementById('join-user-id').value.trim();
        
        if (!roomId || !userName) {
            alert('请填写房间号和用户名');
            return;
        }
        
        this.roomId = roomId;
        this.userName = userName;
        this.userId = userIdInput || `guest_${Date.now()}`;
        
        try {
            await this.socket.connect();
            
            this.webrtc = new WebRTCClient(this.socket);
            this.mfccExtractor = new MFCCExtractor();
            
            await this.webrtc.initLocalStream();
            
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = this.webrtc.localStream;
            
            await this.mfccExtractor.init(this.webrtc.localStream);
            this.mfccExtractor.onMFCC = (mfcc, waveform) => this.sendMFCCData(mfcc, waveform);
            
            this.socket.emit('join_call', {
                room_id: this.roomId,
                user_id: this.userId,
                user_name: this.userName
            });
            
            document.getElementById('current-room').textContent = this.roomId;
            document.getElementById('current-user').textContent = this.userName;
            
            this.showView('call');
            this.visualizer.start();
            
        } catch (error) {
            console.error('Failed to join room:', error);
            alert('加入房间失败: ' + error.message);
        }
    }
    
    handleJoined(data) {
        console.log('Joined room:', data);
    }
    
    handleUserJoined(data) {
        console.log('User joined:', data);
        this.addConnectedUser(data.user_id, data.user_name);
    }
    
    handleUserLeft(data) {
        console.log('User left:', data);
        this.removeConnectedUser(data.user_id);
        this.webrtc?.removePeer(data.sid);
    }
    
    handleSignal(data) {
        this.webrtc?.handleSignal(data.sender_sid, data.data);
    }
    
    addConnectedUser(userId, userName) {
        this.connectedUsers.set(userId, userName);
        this.updateUsersList();
    }
    
    removeConnectedUser(userId) {
        this.connectedUsers.delete(userId);
        this.updateUsersList();
    }
    
    updateUsersList() {
        const container = document.getElementById('users-list');
        container.innerHTML = '';
        
        this.connectedUsers.forEach((name, id) => {
            const item = document.createElement('div');
            item.className = 'user-item';
            item.innerHTML = `
                <div class="user-avatar">${name.charAt(0).toUpperCase()}</div>
                <span>${name}</span>
                <div class="user-status"></div>
            `;
            container.appendChild(item);
        });
    }
    
    sendMFCCData(mfcc, waveform) {
        if (!this.analysisEnabled) return;
        
        this.socket.emit('voiceprint_feature', {
            room_id: this.roomId,
            user_id: this.userId,
            mfcc: Array.from(mfcc),
            waveform: Array.from(waveform),
            timestamp: Date.now()
        });
    }
    
    handleSpeakerIdentified(data) {
        this.visualizer.updateWaveform(data.waveform || []);
        
        const matches = data.all_matches || [];
        this.heatmapData.push({
            timestamp: Date.now(),
            matches: matches
        });
        if (this.heatmapData.length > 50) this.heatmapData.shift();
        
        this.visualizer.updateHeatmap(this.heatmapData);
        
        const speakerDisplay = document.getElementById('current-speaker');
        const name = data.identified_name || 'Unknown';
        const similarity = (data.similarity * 100).toFixed(1);
        
        speakerDisplay.querySelector('.speaker-name').textContent = name;
        speakerDisplay.querySelector('.speaker-similarity').textContent = `相似度: ${similarity}%`;
        
        this.addToHistory(name, similarity);
    }
    
    addToHistory(name, similarity) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString();
        
        this.recognitionHistory.unshift({ name, similarity, time: timeStr });
        if (this.recognitionHistory.length > 20) this.recognitionHistory.pop();
        
        const container = document.getElementById('recognition-history');
        container.innerHTML = '';
        
        this.recognitionHistory.slice(0, 10).forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <span class="history-name">${item.name}</span>
                <span>${item.time}</span>
                <span class="history-similarity">${item.similarity}%</span>
            `;
            container.appendChild(div);
        });
    }
    
    leaveRoom() {
        this.mfccExtractor?.stop();
        this.webrtc?.close();
        this.socket.emit('leave_call', {
            room_id: this.roomId,
            user_id: this.userId
        });
        this.socket.disconnect();
        
        this.visualizer.stop();
        this.heatmapData = [];
        this.recognitionHistory = [];
        this.connectedUsers.clear();
        
        this.showView('login');
    }
    
    async registerVoiceprint() {
        const roomId = document.getElementById('reg-room-id').value.trim();
        const userName = document.getElementById('reg-user-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        
        if (!roomId || !userName) {
            this.showRegisterResult('请填写房间号和用户名', false);
            return;
        }
        
        const samples = this.audioRecorder.getSamples();
        if (!samples[1] || !samples[2] || !samples[3]) {
            this.showRegisterResult('请录制完整的3段音频样本', false);
            return;
        }
        
        try {
            const formData = new FormData();
            formData.append('room_id', roomId);
            formData.append('user_name', userName);
            formData.append('email', email);
            formData.append('audio_1', samples[1], 'sample_1.wav');
            formData.append('audio_2', samples[2], 'sample_2.wav');
            formData.append('audio_3', samples[3], 'sample_3.wav');
            
            const response = await fetch('/api/register', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showRegisterResult(`注册成功！您的用户ID: ${result.user_id}`, true);
                document.getElementById('join-user-id').value = result.user_id;
            } else {
                this.showRegisterResult('注册失败: ' + result.error, false);
            }
        } catch (error) {
            this.showRegisterResult('注册失败: ' + error.message, false);
        }
    }
    
    showRegisterResult(message, success) {
        const resultDiv = document.getElementById('register-result');
        resultDiv.textContent = message;
        resultDiv.className = `result-message ${success ? 'success' : 'error'}`;
    }
    
    checkAllSamplesRecorded() {
        setInterval(() => {
            const samples = this.audioRecorder.getSamples();
            const allRecorded = samples[1] && samples[2] && samples[3];
            document.getElementById('register-btn').disabled = !allRecorded;
        }, 500);
    }
    
    showView(viewName) {
        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === `${viewName}-view`);
        });
        this.currentView = viewName;
    }
    
    toggleAudio() {
        this.audioEnabled = !this.audioEnabled;
        document.getElementById('toggle-audio').classList.toggle('active', this.audioEnabled);
        if (this.webrtc?.localStream) {
            this.webrtc.localStream.getAudioTracks().forEach(t => t.enabled = this.audioEnabled);
        }
    }
    
    toggleVideo() {
        this.videoEnabled = !this.videoEnabled;
        document.getElementById('toggle-video').classList.toggle('active', this.videoEnabled);
        if (this.webrtc?.localStream) {
            this.webrtc.localStream.getVideoTracks().forEach(t => t.enabled = this.videoEnabled);
        }
    }
    
    toggleAnalysis() {
        this.analysisEnabled = !this.analysisEnabled;
        document.getElementById('toggle-analysis').classList.toggle('active', this.analysisEnabled);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new VoiceprintApp();
});
