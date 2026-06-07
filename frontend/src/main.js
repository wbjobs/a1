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
        this.isHost = false;
        
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
        this.fullHistory = [];
        this.connectedUsers = new Map();
        this.registeredUsers = [];
        
        this.whitelist = [];
        this.whitelistEnabled = false;
        this.hostUserId = null;
        
        this.isSeeking = false;
        this.seekStartTime = null;
        this.timelineData = [];
        this.maxTimelinePoints = 300;
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.audioRecorder = new AudioRecorder();
        this.visualizer = new Visualizer();
        this.socket = new SocketClient();
        
        this.setupSocketHandlers();
        this.checkAllSamplesRecorded();
        this.startStatsUpdate();
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
        
        document.getElementById('enable-whitelist').addEventListener('change', (e) => this.toggleWhitelistEnabled(e.target.checked));
        document.getElementById('add-whitelist-btn').addEventListener('click', () => this.addToWhitelist());
        document.getElementById('play-live-btn').addEventListener('click', () => this.returnToLive());
        
        const timelineSlider = document.getElementById('timeline-slider');
        timelineSlider.addEventListener('input', (e) => this.handleTimelineInput(e.target.value));
        timelineSlider.addEventListener('change', (e) => this.handleTimelineSeek(e.target.value));
    }
    
    setupSocketHandlers() {
        this.socket.on('speaker_identified', (data) => this.handleSpeakerIdentified(data));
        this.socket.on('user_joined', (data) => this.handleUserJoined(data));
        this.socket.on('user_left', (data) => this.handleUserLeft(data));
        this.socket.on('joined', (data) => this.handleJoined(data));
        this.socket.on('signal', (data) => this.handleSignal(data));
        this.socket.on('whitelist_updated', (data) => this.handleWhitelistUpdated(data));
        this.socket.on('history_data', (data) => this.handleHistoryData(data));
        this.socket.on('seek_result', (data) => this.handleSeekResult(data));
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
            this.mfccExtractor.onDelta = (deltaData, waveform) => this.sendDeltaData(deltaData, waveform);
            
            this.socket.emit('join_call', {
                room_id: this.roomId,
                user_id: this.userId,
                user_name: this.userName
            });
            
            document.getElementById('current-room').textContent = this.roomId;
            document.getElementById('current-user').textContent = this.userName;
            
            await this.fetchRoomData();
            await this.setHostIfNeeded();
            
            this.showView('call');
            this.visualizer.start();
            this.initTimeline();
            
        } catch (error) {
            console.error('Failed to join room:', error);
            alert('加入房间失败: ' + error.message);
        }
    }
    
    async fetchRoomData() {
        try {
            const response = await fetch(`/api/rooms/${this.roomId}/users`);
            const data = await response.json();
            if (data.success) {
                this.registeredUsers = data.users;
                this.updateUserSelect();
            }
            
            const whitelistResponse = await fetch(`/api/rooms/${this.roomId}/whitelist`);
            const whitelistData = await whitelistResponse.json();
            if (whitelistData.success) {
                this.whitelist = whitelistData.whitelist || [];
                this.whitelistEnabled = whitelistData.whitelist_enabled || false;
                this.hostUserId = whitelistData.host_user_id;
                this.updateWhitelistUI();
            }
        } catch (error) {
            console.error('Failed to fetch room data:', error);
        }
    }
    
    async setHostIfNeeded() {
        if (!this.hostUserId && this.userId.startsWith('guest_') === false) {
            try {
                await fetch(`/api/rooms/${this.roomId}/host`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: this.userId })
                });
                this.hostUserId = this.userId;
                this.isHost = true;
                this.updateWhitelistUI();
            } catch (error) {
                console.error('Failed to set host:', error);
            }
        } else {
            this.isHost = this.hostUserId === this.userId;
            this.updateWhitelistUI();
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
    
    handleWhitelistUpdated(data) {
        this.whitelist = data.whitelist || [];
        this.whitelistEnabled = data.whitelist_enabled || false;
        this.updateWhitelistUI();
    }
    
    handleHistoryData(data) {
        console.log('Received history data:', data);
    }
    
    handleSeekResult(data) {
        if (data.record) {
            this.displaySeekResult(data.record);
        }
    }
    
    addConnectedUser(userId, userName) {
        this.connectedUsers.set(userId, userName);
        this.updateUsersList();
        this.updateUserSelect();
    }
    
    removeConnectedUser(userId) {
        this.connectedUsers.delete(userId);
        this.updateUsersList();
    }
    
    updateUsersList() {
        const container = document.getElementById('users-list');
        container.innerHTML = '';
        
        this.connectedUsers.forEach((name, id) => {
            const isWhitelisted = this.isUserWhitelisted(id);
            const item = document.createElement('div');
            item.className = 'user-item';
            item.innerHTML = `
                <div class="user-avatar">${name.charAt(0).toUpperCase()}</div>
                <span>${name}</span>
                <div class="whitelist-badge ${isWhitelisted ? 'whitelisted' : 'non-whitelisted'}" 
                     title="${isWhitelisted ? '白名单用户' : '非白名单用户'}"></div>
                <div class="user-status"></div>
            `;
            container.appendChild(item);
        });
    }
    
    updateUserSelect() {
        const select = document.getElementById('whitelist-user-select');
        if (!select) return;
        
        select.innerHTML = '';
        const allUsers = [...new Set([
            ...this.registeredUsers.map(u => ({ id: u.user_id, name: u.user_name })),
            ...Array.from(this.connectedUsers.entries()).map(([id, name]) => ({ id, name }))
        ])];
        
        const whitelistIds = this.whitelist.map(w => w.user_id);
        
        allUsers.forEach(user => {
            if (!whitelistIds.includes(user.id)) {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = user.name;
                select.appendChild(option);
            }
        });
    }
    
    updateWhitelistUI() {
        const statusBadge = document.getElementById('whitelist-status');
        if (statusBadge) {
            statusBadge.textContent = this.whitelistEnabled ? '已启用' : '未启用';
            statusBadge.className = `status-badge ${this.whitelistEnabled ? 'enabled' : 'disabled'}`;
        }
        
        const controls = document.getElementById('whitelist-controls');
        const addForm = document.getElementById('add-whitelist-form');
        const enableCheckbox = document.getElementById('enable-whitelist');
        
        if (this.isHost) {
            if (controls) controls.style.display = 'flex';
            if (addForm) addForm.style.display = 'flex';
            if (enableCheckbox) enableCheckbox.checked = this.whitelistEnabled;
        } else {
            if (controls) controls.style.display = 'none';
            if (addForm) addForm.style.display = 'none';
        }
        
        this.updateWhitelistList();
        this.updateUserSelect();
        this.updateVideoBorders();
    }
    
    updateWhitelistList() {
        const container = document.getElementById('whitelist-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (this.whitelist.length === 0) {
            container.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:10px;">暂无白名单用户</div>';
            return;
        }
        
        this.whitelist.forEach(user => {
            const item = document.createElement('div');
            item.className = 'whitelist-item';
            item.innerHTML = `
                <span>${user.user_name}</span>
                ${this.isHost ? `<button class="remove-btn" data-user-id="${user.user_id}">移除</button>` : ''}
            `;
            container.appendChild(item);
        });
        
        if (this.isHost) {
            container.querySelectorAll('.remove-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const userId = e.target.dataset.userId;
                    this.removeFromWhitelist(userId);
                });
            });
        }
    }
    
    async toggleWhitelistEnabled(enabled) {
        if (!this.isHost) return;
        
        try {
            await fetch(`/api/rooms/${this.roomId}/whitelist/enable`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: enabled,
                    requester_id: this.userId
                })
            });
        } catch (error) {
            console.error('Failed to toggle whitelist:', error);
        }
    }
    
    async addToWhitelist() {
        if (!this.isHost) return;
        
        const select = document.getElementById('whitelist-user-select');
        const userId = select.value;
        
        if (!userId) {
            alert('请选择要添加的用户');
            return;
        }
        
        try {
            await fetch(`/api/rooms/${this.roomId}/whitelist/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    requester_id: this.userId
                })
            });
        } catch (error) {
            console.error('Failed to add to whitelist:', error);
        }
    }
    
    async removeFromWhitelist(userId) {
        if (!this.isHost) return;
        
        try {
            await fetch(`/api/rooms/${this.roomId}/whitelist/remove`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    requester_id: this.userId
                })
            });
        } catch (error) {
            console.error('Failed to remove from whitelist:', error);
        }
    }
    
    isUserWhitelisted(userId) {
        if (!this.whitelistEnabled) return true;
        return this.whitelist.some(w => w.user_id === userId);
    }
    
    sendDeltaData(deltaData, waveform) {
        if (!this.analysisEnabled || this.isSeeking) return;
        
        this.socket.emit('voiceprint_feature', {
            room_id: this.roomId,
            user_id: this.userId,
            delta: deltaData,
            waveform: Array.from(waveform),
            timestamp: Date.now()
        });
    }
    
    handleSpeakerIdentified(data) {
        if (this.isSeeking) return;
        
        this.addToTimeline(data);
        
        this.visualizer.updateWaveform(data.waveform || []);
        
        const matches = data.all_matches || [];
        this.heatmapData.push({
            timestamp: data.timestamp,
            matches: matches
        });
        if (this.heatmapData.length > 50) this.heatmapData.shift();
        
        this.visualizer.updateHeatmap(this.heatmapData);
        
        const speakerDisplay = document.getElementById('current-speaker');
        const name = data.identified_name || 'Unknown';
        const similarity = (data.similarity * 100).toFixed(1);
        const isWhitelisted = data.is_whitelisted;
        
        speakerDisplay.querySelector('.speaker-name').textContent = name;
        speakerDisplay.querySelector('.speaker-similarity').textContent = `相似度: ${similarity}%`;
        
        const whitelistIndicator = document.getElementById('speaker-whitelist-status');
        if (data.whitelist_enabled) {
            whitelistIndicator.style.display = 'inline-block';
            whitelistIndicator.className = `whitelist-indicator ${isWhitelisted ? 'whitelisted' : 'non-whitelisted'}`;
            whitelistIndicator.textContent = isWhitelisted ? '✓ 白名单用户' : '⚠ 非白名单用户';
        } else {
            whitelistIndicator.style.display = 'none';
        }
        
        this.addToHistory(name, similarity, isWhitelisted, data.whitelist_enabled);
        this.updateVideoBorders(data.identified_id);
        
        this.fullHistory.push({
            timestamp: data.timestamp,
            name: name,
            similarity: similarity,
            isWhitelisted: isWhitelisted,
            matches: matches
        });
        if (this.fullHistory.length > 1000) this.fullHistory.shift();
    }
    
    updateVideoBorders(activeSpeakerId = null) {
        document.querySelectorAll('.video-wrapper').forEach(wrapper => {
            wrapper.classList.remove('whitelisted', 'non-whitelisted');
        });
        
        if (this.whitelistEnabled && activeSpeakerId) {
            const isWhitelisted = this.isUserWhitelisted(activeSpeakerId);
            const localWrapper = document.getElementById('local-wrapper');
            
            if (activeSpeakerId === this.userId) {
                if (localWrapper) {
                    localWrapper.classList.add(isWhitelisted ? 'whitelisted' : 'non-whitelisted');
                }
            } else {
                const remoteWrapper = document.querySelector(`[data-user-id="${activeSpeakerId}"]`);
                if (remoteWrapper) {
                    remoteWrapper.classList.add(isWhitelisted ? 'whitelisted' : 'non-whitelisted');
                }
            }
        }
    }
    
    addToHistory(name, similarity, isWhitelisted, whitelistEnabled) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString();
        
        this.recognitionHistory.unshift({ 
            name, similarity, time: timeStr, 
            isWhitelisted, whitelistEnabled 
        });
        if (this.recognitionHistory.length > 20) this.recognitionHistory.pop();
        
        const container = document.getElementById('recognition-history');
        container.innerHTML = '';
        
        this.recognitionHistory.slice(0, 10).forEach(item => {
            const div = document.createElement('div');
            div.className = `history-item ${item.whitelistEnabled && !item.isWhitelisted ? 'non-whitelisted' : ''}`;
            div.innerHTML = `
                <span class="history-name">${item.name}</span>
                <span>${item.time}</span>
                <span class="history-similarity">${item.similarity}%</span>
            `;
            container.appendChild(div);
        });
    }
    
    initTimeline() {
        this.seekStartTime = Date.now();
        this.timelineData = [];
        
        const slider = document.getElementById('timeline-slider');
        slider.value = 100;
        
        this.updateTimelineLabels();
    }
    
    addToTimeline(data) {
        const point = {
            timestamp: data.timestamp,
            identifiedId: data.identified_id,
            identifiedName: data.identified_name,
            similarity: data.similarity,
            isWhitelisted: data.is_whitelisted
        };
        
        this.timelineData.push(point);
        if (this.timelineData.length > this.maxTimelinePoints) {
            this.timelineData.shift();
        }
        
        this.updateTimelineCanvas();
    }
    
    updateTimelineCanvas() {
        const canvas = document.getElementById('timeline-canvas');
        if (!canvas) return;
        
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        
        const width = rect.width;
        const height = rect.height;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, width, height);
        
        if (this.timelineData.length === 0) return;
        
        const barWidth = Math.max(2, width / this.maxTimelinePoints);
        const startX = width - this.timelineData.length * barWidth;
        
        this.timelineData.forEach((point, i) => {
            const x = startX + i * barWidth;
            const barHeight = Math.max(4, point.similarity * (height - 8));
            const y = height - barHeight;
            
            let color;
            if (this.whitelistEnabled && !point.isWhitelisted) {
                color = '#ef4444';
            } else {
                const hue = 200 + point.similarity * 80;
                color = `hsl(${hue}, 70%, 50%)`;
            }
            
            ctx.fillStyle = color;
            ctx.fillRect(x, y, barWidth - 1, barHeight);
        });
        
        const slider = document.getElementById('timeline-slider');
        const seekPosition = parseInt(slider.value) / 100;
        if (seekPosition < 1) {
            const seekX = width * seekPosition;
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(seekX, 0);
            ctx.lineTo(seekX, height);
            ctx.stroke();
        }
    }
    
    updateTimelineLabels() {
        if (!this.seekStartTime) return;
        
        const now = Date.now();
        const duration = now - this.seekStartTime;
        const maxDuration = Math.max(duration, 5 * 60 * 1000);
        
        document.getElementById('time-start').textContent = `-${Math.floor(maxDuration / 60000)}m`;
        document.getElementById('time-mid').textContent = `-${Math.floor(maxDuration / 120000)}m`;
        document.getElementById('time-end').textContent = '现在';
    }
    
    handleTimelineInput(value) {
        const position = parseInt(value) / 100;
        const timeDisplay = document.getElementById('time-display');
        
        if (position >= 1) {
            timeDisplay.textContent = '实时';
            this.isSeeking = false;
            document.getElementById('play-live-btn').style.display = 'none';
            this.updateTimelineCanvas();
        } else {
            this.isSeeking = true;
            const targetTime = this.getTimeFromPosition(position);
            timeDisplay.textContent = new Date(targetTime).toLocaleTimeString();
            document.getElementById('play-live-btn').style.display = 'inline-block';
            
            this.updateTimelineCanvas();
        }
    }
    
    handleTimelineSeek(value) {
        const position = parseInt(value) / 100;
        
        if (position >= 1) {
            this.returnToLive();
            return;
        }
        
        const targetTime = this.getTimeFromPosition(position);
        
        this.socket.emit('seek_history', {
            room_id: this.roomId,
            timestamp: targetTime
        });
    }
    
    getTimeFromPosition(position) {
        if (!this.seekStartTime) return Date.now();
        
        const now = Date.now();
        const maxDuration = Math.max(now - this.seekStartTime, 5 * 60 * 1000);
        return this.seekStartTime + maxDuration * position;
    }
    
    displaySeekResult(record) {
        const speakerDisplay = document.getElementById('current-speaker');
        const name = record.identified_name || 'Unknown';
        const similarity = (record.similarity * 100).toFixed(1);
        const isWhitelisted = record.is_whitelisted;
        
        speakerDisplay.querySelector('.speaker-name').textContent = name;
        speakerDisplay.querySelector('.speaker-similarity').textContent = `相似度: ${similarity}%`;
        
        const whitelistIndicator = document.getElementById('speaker-whitelist-status');
        if (this.whitelistEnabled) {
            whitelistIndicator.style.display = 'inline-block';
            whitelistIndicator.className = `whitelist-indicator ${isWhitelisted ? 'whitelisted' : 'non-whitelisted'}`;
            whitelistIndicator.textContent = isWhitelisted ? '✓ 白名单用户' : '⚠ 非白名单用户';
        }
        
        const matches = record.all_matches || [];
        this.visualizer.updateHeatmap([{
            timestamp: record.timestamp,
            matches: matches
        }]);
    }
    
    returnToLive() {
        this.isSeeking = false;
        const slider = document.getElementById('timeline-slider');
        slider.value = 100;
        
        document.getElementById('time-display').textContent = '实时';
        document.getElementById('play-live-btn').style.display = 'none';
        
        if (this.heatmapData.length > 0) {
            this.visualizer.updateHeatmap(this.heatmapData);
        }
        
        this.updateTimelineCanvas();
    }
    
    startStatsUpdate() {
        setInterval(() => {
            if (!this.mfccExtractor || !this.currentView === 'call') return;
            
            const stats = this.mfccExtractor.getStats();
            document.getElementById('stat-keyframes').textContent = stats.keyframes;
            document.getElementById('stat-deltas').textContent = stats.deltas;
            document.getElementById('stat-compression').textContent = stats.compressionRatio;
        }, 1000);
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
        this.fullHistory = [];
        this.timelineData = [];
        this.connectedUsers.clear();
        
        this.whitelist = [];
        this.whitelistEnabled = false;
        this.isHost = false;
        this.isSeeking = false;
        
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
