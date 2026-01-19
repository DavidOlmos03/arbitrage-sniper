const WebSocket = require('ws');

class CoinbaseExchange {
  constructor(config, onMessage) {
    this.config = config;
    this.onMessage = onMessage;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
    this.isConnected = false;
  }

  connect() {
    console.log('[Coinbase] Connecting...');

    this.ws = new WebSocket(this.config.url);

    this.ws.on('open', () => {
      console.log('[Coinbase] Connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Subscribe to BTC-USD ticker
      const subscribeMsg = {
        type: 'subscribe',
        product_ids: ['BTC-USD'],
        channels: ['ticker']
      };
      this.ws.send(JSON.stringify(subscribeMsg));
    });

    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data);
        const normalized = this.parseMessage(parsed);
        if (normalized) {
          this.onMessage(normalized);
        }
      } catch (error) {
        console.error('[Coinbase] Parse error:', error.message);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[Coinbase] WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('[Coinbase] Connection closed');
      this.isConnected = false;
      this.reconnect();
    });
  }

  parseMessage(data) {
    // Coinbase ticker format
    if (data.type === 'ticker' && data.product_id === 'BTC-USD') {
      return {
        exchange: 'coinbase',
        price: data.price,
        volume: data.last_size || 0,
        timestamp: new Date(data.time).getTime(),
        type: 'ticker'
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
    console.log(`[Coinbase] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => this.connect(), delay);
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = CoinbaseExchange;
