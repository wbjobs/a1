export class AudioRecorder {
    constructor() {
        this.samples = {};
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.currentSampleNum = null;
        this.recordingTimer = null;
        this.timerInterval = null;
    }

    async recordSample(sampleNum) {
        if (this.isRecording) {
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100
                }
            });

            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm'
            });
            this.recordedChunks = [];
            this.currentSampleNum = sampleNum;
            this.isRecording = true;

            this.updateSampleUI(sampleNum, 'recording');

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.handleRecordingComplete(stream);
            };

            this.mediaRecorder.start(100);
            this.startTimer(sampleNum);

            setTimeout(() => {
                this.stopRecording();
            }, 5000);

        } catch (error) {
            console.error('Failed to start recording:', error);
            alert('无法访问麦克风，请检查权限设置');
            this.updateSampleUI(sampleNum, 'error');
        }
    }

    startTimer(sampleNum) {
        let count = 5;
        const timerDisplay = document.getElementById('recording-timer');
        const timerCount = document.getElementById('timer-count');
        
        timerDisplay.style.display = 'block';
        timerCount.textContent = count;

        this.timerInterval = setInterval(() => {
            count--;
            if (count > 0) {
                timerCount.textContent = count;
            } else {
                this.stopTimer();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        document.getElementById('recording-timer').style.display = 'none';
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
        }
    }

    handleRecordingComplete(stream) {
        stream.getTracks().forEach(track => track.stop());
        
        if (this.recordedChunks.length === 0) {
            console.error('No audio data recorded');
            this.updateSampleUI(this.currentSampleNum, 'error');
            this.stopTimer();
            return;
        }

        const webmBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        
        this.convertToWav(webmBlob).then(wavBlob => {
            this.samples[this.currentSampleNum] = wavBlob;
            
            const audioElement = document.querySelector(
                `.sample-item[data-sample="${this.currentSampleNum}"] .sample-audio`
            );
            if (audioElement) {
                audioElement.src = URL.createObjectURL(wavBlob);
                audioElement.style.display = 'block';
            }
            
            this.updateSampleUI(this.currentSampleNum, 'completed');
        }).catch(error => {
            console.error('Failed to convert audio:', error);
            this.samples[this.currentSampleNum] = webmBlob;
            
            const audioElement = document.querySelector(
                `.sample-item[data-sample="${this.currentSampleNum}"] .sample-audio`
            );
            if (audioElement) {
                audioElement.src = URL.createObjectURL(webmBlob);
                audioElement.style.display = 'block';
            }
            
            this.updateSampleUI(this.currentSampleNum, 'completed');
        });

        this.stopTimer();
        this.mediaRecorder = null;
        this.recordedChunks = [];
    }

    async convertToWav(webmBlob) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 44100
        });
        
        const arrayBuffer = await webmBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        const wavBlob = this.audioBufferToWav(audioBuffer);
        audioContext.close();
        
        return wavBlob;
    }

    audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1;
        const bitDepth = 16;
        
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        
        const dataLength = buffer.length * blockAlign;
        const bufferLength = 44 + dataLength;
        
        const arrayBuffer = new ArrayBuffer(bufferLength);
        const view = new DataView(arrayBuffer);
        
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);
        
        const channels = [];
        for (let i = 0; i < numChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }
        
        let offset = 44;
        for (let i = 0; i < buffer.length; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, channels[channel][i]));
                const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, intSample, true);
                offset += 2;
            }
        }
        
        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    updateSampleUI(sampleNum, status) {
        const sampleItem = document.querySelector(`.sample-item[data-sample="${sampleNum}"]`);
        if (!sampleItem) return;

        const statusElement = sampleItem.querySelector('.sample-status');
        const button = sampleItem.querySelector('.record-btn');

        switch (status) {
            case 'recording':
                statusElement.textContent = '录制中...';
                statusElement.className = 'sample-status recording';
                button.textContent = '录制中';
                button.disabled = true;
                break;
            case 'completed':
                statusElement.textContent = '已录制';
                statusElement.className = 'sample-status completed';
                button.textContent = '重新录制';
                button.disabled = false;
                break;
            case 'error':
                statusElement.textContent = '录制失败';
                statusElement.className = 'sample-status';
                button.textContent = '重试';
                button.disabled = false;
                break;
            default:
                statusElement.textContent = '未录制';
                statusElement.className = 'sample-status';
                button.textContent = '录制';
                button.disabled = false;
        }
    }

    getSamples() {
        return { ...this.samples };
    }

    getSample(sampleNum) {
        return this.samples[sampleNum] || null;
    }

    clearSample(sampleNum) {
        delete this.samples[sampleNum];
        this.updateSampleUI(sampleNum, 'idle');
        
        const audioElement = document.querySelector(
            `.sample-item[data-sample="${sampleNum}"] .sample-audio`
        );
        if (audioElement) {
            audioElement.src = '';
            audioElement.style.display = 'none';
        }
    }

    clearAll() {
        for (let i = 1; i <= 3; i++) {
            this.clearSample(i);
        }
    }
}
