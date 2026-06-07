import { io } from 'socket.io-client';

export class SocketClient {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.eventHandlers = new Map();
    }

    async connect() {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const host = window.location.hostname;
            const port = 5000;
            const url = `${protocol}://${host}:${port}`;
            
            this.socket = io(url, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionAttempts: 5
            });

            this.socket.on('connect', () => {
                console.log('Socket connected:', this.socket.id);
                this.connected = true;
                resolve(this.socket);
            });

            this.socket.on('connect_error', (error) => {
                console.error('Socket connection error:', error);
                reject(error);
            });

            this.socket.on('disconnect', () => {
                console.log('Socket disconnected');
                this.connected = false;
            });

            this.socket.onAny((eventName, ...args) => {
                const handlers = this.eventHandlers.get(eventName);
                if (handlers) {
                    handlers.forEach(handler => handler(...args));
                }
            });
        });
    }

    on(eventName, handler) {
        if (!this.eventHandlers.has(eventName)) {
            this.eventHandlers.set(eventName, new Set());
        }
        this.eventHandlers.get(eventName).add(handler);
        
        if (this.socket) {
            this.socket.on(eventName, handler);
        }
    }

    off(eventName, handler) {
        const handlers = this.eventHandlers.get(eventName);
        if (handlers) {
            handlers.delete(handler);
        }
        
        if (this.socket && handler) {
            this.socket.off(eventName, handler);
        }
    }

    emit(eventName, data) {
        if (this.socket && this.connected) {
            this.socket.emit(eventName, data);
        } else {
            console.warn('Socket not connected, cannot emit:', eventName);
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
        this.eventHandlers.clear();
    }

    isConnected() {
        return this.connected && this.socket !== null;
    }
}
