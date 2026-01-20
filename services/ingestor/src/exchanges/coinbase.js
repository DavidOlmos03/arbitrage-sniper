/**
 * @fileoverview Coinbase WebSocket exchange handler
 * Manages WebSocket connection to Coinbase ticker channel and message parsing
 * @module exchanges/coinbase
 */

const WebSocket = require('ws');

/**
 * @typedef {Object} CoinbaseConfig
 * @property {string} url - WebSocket URL for Coinbase
 * @property {string} name - Exchange identifier
 */

/**
 * @typedef {Object} CoinbaseTickerMessage
 * @property {string} type - Message type ('ticker', 'subscriptions', etc.)
 * @property {string} product_id - Trading pair (e.g., 'BTC-USD')
 * @property {string} price - Current price
 * @property {string} [last_size] - Last trade size
 * @property {string} time - ISO timestamp
 */

/**
 * @callback MessageCallback
 * @param {Object} normalizedMessage - Normalized message object
 * @returns {void|Promise<void>}
 */

/**
 * Coinbase WebSocket exchange handler
 *
 * Connects to Coinbase WebSocket ticker channel and handles:
 * - Initial connection and subscription
 * - Message parsing from Coinbase-specific format
 * - Auto-reconnection with exponential backoff
 *
 * @class
 * @example
 * const coinbase = new CoinbaseExchange(config, (msg) => {
 *   console.log('Received:', msg);
 * });
 * coinbase.connect();
 */
class CoinbaseExchange {
  /**
   * Creates a Coinbase exchange handler
   *
   * @param {CoinbaseConfig} config - Exchange configuration
   * @param {MessageCallback} onMessage - Callback invoked for each parsed message
   */
  constructor(config, onMessage) {
    /**
     * Exchange configuration
     * @type {CoinbaseConfig}
     * @private
     */
    this.config = config;

    /**
     * Message callback function
     * @type {MessageCallback}
     * @private
     */
    this.onMessage = onMessage;

    /**
     * WebSocket instance
     * @type {WebSocket|null}
     * @private
     */
    this.ws = null;

    /**
     * Number of reconnection attempts
     * @type {number}
     */
    this.reconnectAttempts = 0;

    /**
     * Maximum reconnection delay in milliseconds
     * @type {number}
     * @private
     */
    this.maxReconnectDelay = 30000;

    /**
     * Connection status
     * @type {boolean}
     */
    this.isConnected = false;
  }

  /**
   * Establishes WebSocket connection to Coinbase
   *
   * After connection, sends subscription message for BTC-USD ticker channel.
   * Sets up event handlers for message processing and reconnection.
   *
   * @returns {void}
   */
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

  /**
   * Parses Coinbase-specific ticker message format
   *
   * Coinbase ticker format:
   * {
   *   type: 'ticker',
   *   product_id: 'BTC-USD',
   *   price: '45100.00',
   *   last_size: '0.5',
   *   time: '2024-01-19T10:15:23.456Z'
   * }
   *
   * @param {CoinbaseTickerMessage} data - Raw Coinbase ticker message
   * @returns {Object|null} Normalized message or null if not a BTC-USD ticker
   * @private
   */
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

  /**
   * Reconnects to Coinbase with exponential backoff
   *
   * Backoff formula: min(1000 * 2^attempts, 30000)
   * Results in delays: 1s, 2s, 4s, 8s, 16s, 30s (max)
   *
   * @private
   * @returns {void}
   */
  reconnect() {
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    console.log(`[Coinbase] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => this.connect(), delay);
  }

  /**
   * Closes the WebSocket connection
   * Should be called during graceful shutdown
   *
   * @returns {void}
   */
  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = CoinbaseExchange;
