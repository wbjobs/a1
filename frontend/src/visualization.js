export class Visualizer {
    constructor() {
        this.waveformCanvas = null;
        this.heatmapCanvas = null;
        this.waveformCtx = null;
        this.heatmapCtx = null;
        this.animationId = null;
        this.isRunning = false;
        
        this.currentWaveform = [];
        this.heatmapData = [];
        this.heatmapHistory = [];
        this.maxHistory = 50;
        
        this.initCanvases();
    }

    initCanvases() {
        setTimeout(() => {
            this.waveformCanvas = document.getElementById('waveform-canvas');
            this.heatmapCanvas = document.getElementById('heatmap-canvas');
            
            if (this.waveformCanvas) {
                this.waveformCtx = this.waveformCanvas.getContext('2d');
                this.resizeCanvas(this.waveformCanvas);
            }
            
            if (this.heatmapCanvas) {
                this.heatmapCtx = this.heatmapCanvas.getContext('2d');
                this.resizeCanvas(this.heatmapCanvas);
            }
            
            window.addEventListener('resize', () => {
                this.resizeCanvas(this.waveformCanvas);
                this.resizeCanvas(this.heatmapCanvas);
            });
        }, 100);
    }

    resizeCanvas(canvas) {
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    }

    start() {
        this.isRunning = true;
        this.animate();
    }

    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    updateWaveform(waveform) {
        this.currentWaveform = Array.from(waveform);
    }

    updateHeatmap(heatmapData) {
        this.heatmapData = heatmapData;
    }

    animate() {
        if (!this.isRunning) return;
        
        this.drawWaveform();
        this.drawHeatmap();
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    drawWaveform() {
        if (!this.waveformCtx || !this.waveformCanvas) return;
        
        const canvas = this.waveformCanvas;
        const ctx = this.waveformCtx;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, width, height);
        
        if (this.currentWaveform.length === 0) {
            this.drawNoSignal(ctx, width, height);
            return;
        }
        
        const centerY = height / 2;
        const barWidth = width / this.currentWaveform.length;
        const maxAmplitude = height / 2 - 10;
        
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#00d4ff');
        gradient.addColorStop(0.5, '#7c3aed');
        gradient.addColorStop(1, '#f472b6');
        
        ctx.fillStyle = gradient;
        
        for (let i = 0; i < this.currentWaveform.length; i++) {
            const value = this.currentWaveform[i] || 0;
            const amplitude = Math.abs(value) * maxAmplitude;
            const x = i * barWidth;
            
            ctx.fillRect(
                x,
                centerY - amplitude,
                Math.max(barWidth - 1, 1),
                amplitude * 2
            );
        }
        
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        for (let i = 0; i < this.currentWaveform.length; i++) {
            const value = this.currentWaveform[i] || 0;
            const x = i * barWidth + barWidth / 2;
            const y = centerY - value * maxAmplitude;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }

    drawNoSignal(ctx, width, height) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('等待语音输入...', width / 2, height / 2 + 20);
    }

    drawHeatmap() {
        if (!this.heatmapCtx || !this.heatmapCanvas) return;
        
        const canvas = this.heatmapCanvas;
        const ctx = this.heatmapCtx;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, width, height);
        
        if (!this.heatmapData || this.heatmapData.length === 0) {
            this.drawNoHeatmap(ctx, width, height);
            return;
        }
        
        const latestData = this.heatmapData[this.heatmapData.length - 1];
        const matches = latestData.matches || [];
        
        if (matches.length === 0) {
            this.drawNoHeatmap(ctx, width, height);
            return;
        }
        
        this.heatmapHistory.push({
            timestamp: latestData.timestamp,
            matches: matches.slice(0, 5)
        });
        
        if (this.heatmapHistory.length > this.maxHistory) {
            this.heatmapHistory.shift();
        }
        
        const numRows = Math.min(5, matches.length);
        const numCols = this.heatmapHistory.length;
        const cellWidth = width / numCols;
        const cellHeight = (height - 30) / numRows;
        
        const userNames = new Set();
        this.heatmapHistory.forEach(h => {
            h.matches.forEach(m => userNames.add(m.user_name || 'Unknown'));
        });
        const userList = Array.from(userNames).slice(0, numRows);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        
        for (let row = 0; row < numRows; row++) {
            const name = userList[row] || 'Unknown';
            const displayName = name.length > 8 ? name.substring(0, 8) + '...' : name;
            ctx.fillText(displayName, 50, row * cellHeight + cellHeight / 2 + 30 + 3);
        }
        
        const heatmapStartX = 60;
        const heatmapWidth = width - heatmapStartX - 10;
        const adjustedCellWidth = heatmapWidth / numCols;
        
        for (let col = 0; col < numCols; col++) {
            const historyPoint = this.heatmapHistory[col];
            if (!historyPoint) continue;
            
            for (let row = 0; row < numRows; row++) {
                const match = historyPoint.matches[row];
                const similarity = match ? match.similarity : 0;
                
                const x = heatmapStartX + col * adjustedCellWidth;
                const y = row * cellHeight + 30;
                
                const color = this.getHeatmapColor(similarity);
                ctx.fillStyle = color;
                ctx.fillRect(x, y, adjustedCellWidth - 1, cellHeight - 1);
            }
        }
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('时间 →', width - 30, height - 5);
    }

    drawNoHeatmap(ctx, width, height) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('等待识别数据...', width / 2, height / 2);
    }

    getHeatmapColor(value) {
        const clamped = Math.max(0, Math.min(1, value));
        
        let r, g, b;
        
        if (clamped < 0.25) {
            const t = clamped / 0.25;
            r = 59 + t * 6;
            g = 130 + t * 48;
            b = 246 - t * 93;
        } else if (clamped < 0.5) {
            const t = (clamped - 0.25) / 0.25;
            r = 65 + t * 99;
            g = 178 + t * 59;
            b = 153 - t * 44;
        } else if (clamped < 0.75) {
            const t = (clamped - 0.5) / 0.25;
            r = 164 + t * 81;
            g = 237 - t * 80;
            b = 109 - t * 29;
        } else {
            const t = (clamped - 0.75) / 0.25;
            r = 245 + t * 10;
            g = 157 - t * 49;
            b = 80 - t * 32;
        }
        
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.85)`;
    }
}
