export class WebRTCClient {
    constructor(socketClient) {
        this.socket = socketClient;
        this.localStream = null;
        this.peers = new Map();
        this.peerConnections = new Map();
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ];
    }

    async initLocalStream() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100
                }
            });
            return this.localStream;
        } catch (error) {
            console.error('Failed to get media stream:', error);
            throw error;
        }
    }

    async createPeerConnection(targetSid, isInitiator) {
        const config = {
            iceServers: this.iceServers,
            iceCandidatePoolSize: 10
        };

        const pc = new RTCPeerConnection(config);
        
        this.localStream.getTracks().forEach(track => {
            pc.addTrack(track, this.localStream);
        });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('signal', {
                    target_sid: targetSid,
                    data: {
                        type: 'ice-candidate',
                        candidate: event.candidate
                    }
                });
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`ICE state with ${targetSid}:`, pc.iceConnectionState);
            if (pc.iceConnectionState === 'disconnected' || 
                pc.iceConnectionState === 'failed') {
                this.removePeer(targetSid);
            }
        };

        pc.ontrack = (event) => {
            const [stream] = event.streams;
            this.addRemoteVideo(targetSid, stream);
        };

        pc.onnegotiationneeded = async () => {
            if (isInitiator) {
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    this.socket.emit('signal', {
                        target_sid: targetSid,
                        data: {
                            type: 'offer',
                            sdp: pc.localDescription
                        }
                    });
                } catch (error) {
                    console.error('Error creating offer:', error);
                }
            }
        };

        this.peerConnections.set(targetSid, pc);
        return pc;
    }

    async handleSignal(senderSid, data) {
        let pc = this.peerConnections.get(senderSid);

        if (!pc && data.type === 'offer') {
            pc = await this.createPeerConnection(senderSid, false);
        }

        if (!pc) {
            console.warn('No peer connection for', senderSid);
            return;
        }

        try {
            if (data.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.socket.emit('signal', {
                    target_sid: senderSid,
                    data: {
                        type: 'answer',
                        sdp: pc.localDescription
                    }
                });
            } else if (data.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            } else if (data.type === 'ice-candidate') {
                if (data.candidate) {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            }
        } catch (error) {
            console.error('Error handling signal:', error, data);
        }
    }

    addRemoteVideo(sid, stream) {
        const container = document.getElementById('videos-container');
        
        let wrapper = document.getElementById(`video-${sid}`);
        if (wrapper) {
            const video = wrapper.querySelector('video');
            if (video) {
                video.srcObject = stream;
            }
            return;
        }

        wrapper = document.createElement('div');
        wrapper.className = 'video-wrapper';
        wrapper.id = `video-${sid}`;

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = stream;

        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = '远端用户';

        wrapper.appendChild(video);
        wrapper.appendChild(label);
        container.appendChild(wrapper);
    }

    removePeer(sid) {
        const pc = this.peerConnections.get(sid);
        if (pc) {
            pc.close();
            this.peerConnections.delete(sid);
        }

        const wrapper = document.getElementById(`video-${sid}`);
        if (wrapper) {
            wrapper.remove();
        }

        this.peers.delete(sid);
    }

    close() {
        this.peerConnections.forEach((pc, sid) => {
            pc.close();
            const wrapper = document.getElementById(`video-${sid}`);
            if (wrapper) wrapper.remove();
        });
        this.peerConnections.clear();
        this.peers.clear();

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    }
}
