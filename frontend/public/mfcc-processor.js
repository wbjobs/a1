class MFCCProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        this.bufferSize = options.processorOptions.bufferSize || 2048;
        this.sendInterval = options.processorOptions.sendInterval || 5;
        this.silenceThreshold = options.processorOptions.silenceThreshold || 0.01;
        
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        this.frameCount = 0;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'stop') {
                this.isRunning = false;
            }
        };
        
        this.isRunning = true;
    }
    
    process(inputs, outputs, parameters) {
        if (!this.isRunning) return false;
        
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        
        const channelData = input[0];
        
        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.bufferIndex] = channelData[i];
            this.bufferIndex++;
            
            if (this.bufferIndex >= this.bufferSize) {
                this.processBuffer();
                this.bufferIndex = 0;
            }
        }
        
        return true;
    }
    
    processBuffer() {
        const isSilent = this.checkSilence(this.buffer);
        if (isSilent) return;
        
        this.frameCount++;
        if (this.frameCount % this.sendInterval !== 0) return;
        
        const waveform = this.downsample(this.buffer, 100);
        
        this.port.postMessage({
            type: 'audioData',
            buffer: this.buffer.slice(),
            waveform: waveform,
            timestamp: Date.now()
        });
    }
    
    checkSilence(data) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += Math.abs(data[i]);
        }
        const avg = sum / data.length;
        return avg < this.silenceThreshold;
    }
    
    downsample(data, targetLength) {
        const step = data.length / targetLength;
        const result = new Float32Array(targetLength);
        
        for (let i = 0; i < targetLength; i++) {
            const start = Math.floor(i * step);
            const end = Math.floor((i + 1) * step);
            let sum = 0;
            for (let j = start; j < end; j++) {
                sum += data[j];
            }
            result[i] = sum / (end - start);
        }
        
        return result;
    }
}

registerProcessor('mfcc-processor', MFCCProcessor);
