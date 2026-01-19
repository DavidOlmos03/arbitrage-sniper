const WebSocket = require('ws');

class BinanceExchange {
  constructor(config, onMessage) {
    this.config = config;
    this.onMessage = onMessage;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
    this.isConnected = false;
  }

  connect() {
    console.log('[Binance] Connecting...');

    this.ws = new WebSocket(this.config.url);

    this.ws.on('open', () => {
      console.log('[Binance] Connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data);
        const normalized = this.parseMessage(parsed);
        if (normalized) {
          this.onMessage(normalized);
        }
      } catch (error) {
        console.error('[Binance] Parse error:', error.message);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[Binance] WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('[Binance] Connection closed');
      this.isConnected = false;
      this.reconnect();
    });

    this.ws.on('ping', () => {
      this.ws.pong();
    });
  }

  parseMessage(data) {
    // Binance trade stream format
    if (data.e === 'trade') {
      return {
        exchange: 'binance',
        price: data.p,
        volume: data.q,
        timestamp: data.T,
        type: 'trade'
      };
    }
    return null;
  }

  reconnect() {
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    console.log(`[Binance] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => this.connect(), delay);
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = BinanceExchange;
