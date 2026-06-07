export class MFCCExtractor {
    constructor() {
        this.audioContext = null;
        this.sourceNode = null;
        this.analyserNode = null;
        this.workletNode = null;
        this.isRunning = false;
        this.bufferSize = 2048;
        this.sampleRate = 44100;
        this.nMelFilters = 26;
        this.nMFCC = 13;
        this.minFreq = 20;
        this.maxFreq = 8000;
        
        this.melFilterBank = null;
        this.dctMatrix = null;
        
        this.waveformData = new Float32Array(this.bufferSize);
        this.lastMFCC = new Float32Array(this.nMFCC);
        
        this.onMFCC = null;
        this.workletLoaded = false;
    }

    async init(mediaStream) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: this.sampleRate
        });
        
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        
        if (!this.workletLoaded) {
            await this.audioContext.audioWorklet.addModule('/mfcc-processor.js');
            this.workletLoaded = true;
        }
        
        this.sourceNode = this.audioContext.createMediaStreamSource(mediaStream);
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = this.bufferSize * 2;
        this.analyserNode.smoothingTimeConstant = 0.8;
        
        this.workletNode = new AudioWorkletNode(
            this.audioContext,
            'mfcc-processor',
            {
                processorOptions: {
                    bufferSize: this.bufferSize,
                    sendInterval: 5,
                    silenceThreshold: 0.01
                }
            }
        );
        
        this.melFilterBank = this.createMelFilterBank();
        this.dctMatrix = this.createDCTMatrix();
        
        this.workletNode.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                this.handleAudioData(event.data);
            }
        };
        
        this.sourceNode.connect(this.analyserNode);
        this.analyserNode.connect(this.workletNode);
        
        this.isRunning = true;
    }

    handleAudioData(data) {
        if (!this.isRunning) return;
        
        const audioBuffer = data.buffer;
        const waveform = data.waveform;
        
        this.waveformData.set(audioBuffer);
        
        const mfcc = this.computeMFCC(audioBuffer);
        this.lastMFCC = mfcc;
        
        if (this.onMFCC) {
            this.onMFCC(mfcc, waveform);
        }
    }

    computeMFCC(audioData) {
        const windowed = this.applyWindow(audioData);
        const spectrum = this.fft(windowed);
        const powerSpectrum = new Float32Array(spectrum.length);
        for (let i = 0; i < spectrum.length; i++) {
            powerSpectrum[i] = spectrum[i] * spectrum[i] / spectrum.length;
        }
        const melEnergies = this.applyMelFilterBank(powerSpectrum);
        const logMel = new Float32Array(melEnergies.length);
        for (let i = 0; i < melEnergies.length; i++) {
            logMel[i] = Math.log(Math.max(melEnergies[i], 1e-10));
        }
        const mfcc = this.applyDCT(logMel);
        
        return mfcc.slice(0, this.nMFCC);
    }

    applyWindow(data) {
        const result = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
            const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (data.length - 1));
            result[i] = data[i] * window;
        }
        return result;
    }

    fft(data) {
        const n = data.length;
        if (n <= 1) return new Float32Array([data[0] || 0]);
        
        const even = new Float32Array(n / 2);
        const odd = new Float32Array(n / 2);
        
        for (let i = 0; i < n / 2; i++) {
            even[i] = data[i * 2];
            odd[i] = data[i * 2 + 1];
        }
        
        const fftEven = this.fft(even);
        const fftOdd = this.fft(odd);
        
        const result = new Float32Array(n);
        
        for (let k = 0; k < n / 2; k++) {
            const angle = -2 * Math.PI * k / n;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            
            const oddRe = fftOdd[k];
            const oddIm = fftOdd[k + n/2] || 0;
            
            const tRe = cosA * oddRe - sinA * oddIm;
            const tIm = sinA * oddRe + cosA * oddIm;
            
            result[k] = fftEven[k] + tRe;
            result[k + n/2] = fftEven[k] - tRe;
        }
        
        const magnitudes = new Float32Array(n);
        for (let i = 0; i < n / 2; i++) {
            magnitudes[i] = Math.abs(result[i]);
            magnitudes[i + n/2] = magnitudes[i];
        }
        
        return magnitudes;
    }

    freqToMel(freq) {
        return 2595 * Math.log10(1 + freq / 700);
    }

    melToFreq(mel) {
        return 700 * (Math.pow(10, mel / 2595) - 1);
    }

    createMelFilterBank() {
        const nFFT = this.bufferSize;
        const melMin = this.freqToMel(this.minFreq);
        const melMax = this.freqToMel(this.maxFreq);
        const melPoints = new Array(this.nMelFilters + 2);
        
        for (let i = 0; i < this.nMelFilters + 2; i++) {
            const mel = melMin + (melMax - melMin) * i / (this.nMelFilters + 1);
            melPoints[i] = Math.floor((this.melToFreq(mel) / this.sampleRate) * nFFT);
        }
        
        const filterBank = [];
        for (let i = 0; i < this.nMelFilters; i++) {
            const filter = new Float32Array(nFFT / 2);
            const left = melPoints[i];
            const mid = melPoints[i + 1];
            const right = melPoints[i + 2];
            
            for (let j = left; j < mid; j++) {
                filter[j] = (j - left) / (mid - left);
            }
            for (let j = mid; j < right; j++) {
                filter[j] = (right - j) / (right - mid);
            }
            
            filterBank.push(filter);
        }
        
        return filterBank;
    }

    applyMelFilterBank(spectrum) {
        const energies = new Float32Array(this.nMelFilters);
        const halfLen = spectrum.length / 2;
        
        for (let i = 0; i < this.nMelFilters; i++) {
            let energy = 0;
            const filter = this.melFilterBank[i];
            for (let j = 0; j < halfLen; j++) {
                energy += spectrum[j] * filter[j];
            }
            energies[i] = energy;
        }
        
        return energies;
    }

    createDCTMatrix() {
        const matrix = [];
        for (let i = 0; i < this.nMFCC; i++) {
            const row = new Float32Array(this.nMelFilters);
            for (let j = 0; j < this.nMelFilters; j++) {
                row[j] = Math.cos(
                    (Math.PI * i / this.nMelFilters) * (j + 0.5)
                );
            }
            matrix.push(row);
        }
        return matrix;
    }

    applyDCT(data) {
        const result = new Float32Array(this.nMFCC);
        
        for (let i = 0; i < this.nMFCC; i++) {
            let sum = 0;
            const ci = i === 0 ? Math.sqrt(1 / this.nMelFilters) : Math.sqrt(2 / this.nMelFilters);
            const row = this.dctMatrix[i];
            
            for (let j = 0; j < this.nMelFilters; j++) {
                sum += data[j] * row[j];
            }
            
            result[i] = ci * sum;
        }
        
        return result;
    }

    stop() {
        this.isRunning = false;
        
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'stop' });
            this.workletNode.disconnect();
            this.workletNode.port.onmessage = null;
        }
        
        if (this.analyserNode) {
            this.analyserNode.disconnect();
        }
        
        if (this.sourceNode) {
            this.sourceNode.disconnect();
        }
        
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        this.audioContext = null;
        this.sourceNode = null;
        this.analyserNode = null;
        this.workletNode = null;
    }
}
