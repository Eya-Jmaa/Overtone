const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const WS_STATES = {
  CONNECTING: "CONNECTING",
  OPEN: "OPEN",
  CLOSING: "CLOSING",
  CLOSED: "CLOSED",
};

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.state = WS_STATES.CLOSED;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1s
    this.reconnectTimer = null;
    this.messageHandlers = {};
    this.binaryHandlers = {};
    this.connectionId = null;
    this.currentToken = null;
  }

  connect(conversationId, token) {
    if (this.state === WS_STATES.OPEN || this.state === WS_STATES.CONNECTING) {
      return;
    }

    this.state = WS_STATES.CONNECTING;
    this.connectionId = conversationId;
    this.currentToken = token;

    const wsUrl = `${API_URL.replace("http", "ws")}/ws/conversation/${conversationId}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[WS] Connected");
      this.state = WS_STATES.OPEN;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.emit("state", WS_STATES.OPEN);
    };

    this.ws.onclose = (event) => {
      console.log("[WS] Disconnected", event.code, event.reason);
      this.state = WS_STATES.CLOSED;
      this.emit("state", WS_STATES.CLOSED);

      // Auto-reconnect with exponential backoff
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => {
          this.connect(conversationId, this.currentToken);
        }, delay);
      }
    };

    this.ws.onerror = (error) => {
      console.error("[WS] Error", error);
      this.emit("error", error);
    };

    this.ws.onmessage = (event) => {
      // Handle binary audio data
      if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
        this.handleBinary(event.data);
        return;
      }
      
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        // Handle binary data that came as string (unlikely but possible)
        if (typeof event.data === "string" && event.data.includes("[object Blob")) {
          return;
        }
        console.error("[WS] Failed to parse message", e);
      }
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.state = WS_STATES.CLOSING;
      this.ws.close();
      this.ws = null;
    }
    this.state = WS_STATES.CLOSED;
    this.connectionId = null;
  }

  sendControlMessage(type) {
    if (this.state !== WS_STATES.OPEN || !this.ws) {
      console.warn("[WS] Cannot send message: not connected");
      return;
    }
    this.ws.send(JSON.stringify({ type }));
  }

  sendAudioChunk(chunk) {
    if (this.state !== WS_STATES.OPEN || !this.ws) {
      console.warn("[WS] Cannot send audio: not connected");
      return;
    }
    this.ws.send(chunk);
  }

  handleMessage(message) {
    const { type, ...data } = message;
    this.emit(type, data);
  }

  handleBinary(data) {
    // Convert to ArrayBuffer for audio processing
    if (data instanceof Blob) {
      data.arrayBuffer().then(buffer => {
        this.emit("audio_frame", buffer);
      });
    } else if (data instanceof ArrayBuffer) {
      this.emit("audio_frame", data);
    }
  }

  on(event, handler) {
    if (!this.messageHandlers[event]) {
      this.messageHandlers[event] = [];
    }
    this.messageHandlers[event].push(handler);
  }

  off(event, handler) {
    if (!this.messageHandlers[event]) return;
    this.messageHandlers[event] = this.messageHandlers[event].filter(h => h !== handler);
  }

  emit(event, data) {
    if (!this.messageHandlers[event]) return;
    this.messageHandlers[event].forEach(handler => handler(data));
  }

  getState() {
    return this.state;
  }
}

// Singleton instance
let wsClientInstance = null;

export function getWebSocketClient() {
  if (!wsClientInstance) {
    wsClientInstance = new WebSocketClient();
  }
  return wsClientInstance;
}

export { WS_STATES };