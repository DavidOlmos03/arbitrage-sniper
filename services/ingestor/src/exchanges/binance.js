/**
 * @fileoverview Binance WebSocket exchange handler
 * Manages WebSocket connection to Binance trade stream and message parsing
 * @module exchanges/binance
 */

const WebSocket = require('ws');

/**
 * @typedef {Object} BinanceConfig
 * @property {string} url - WebSocket URL for Binance
 * @property {string} name - Exchange identifier
 */

/**
 * @typedef {Object} BinanceTradeMessage
 * @property {string} e - Event type ('trade')
 * @property {string} p - Price
 * @property {string} q - Quantity
 * @property {number} T - Trade time
 */

/**
 * @callback MessageCallback
 * @param {Object} normalizedMessage - Normalized message object
 * @returns {void|Promise<void>}
 */

/**
 * Binance WebSocket exchange handler
 *
 * Connects to Binance WebSocket trade stream and handles:
 * - Initial connection
 * - Message parsing from Binance-specific format
 * - Auto-reconnection with exponential backoff
 * - Ping/pong keepalive
 *
 * @class
 * @example
 * const binance = new BinanceExchange(config, (msg) => {
 *   console.log('Received:', msg);
 * });
 * binance.connect();
 */
class BinanceExchange {
  /**
   * Creates a Binance exchange handler
   *
   * @param {BinanceConfig} config - Exchange configuration
   * @param {MessageCallback} onMessage - Callback invoked for each parsed message
   */
  constructor(config, onMessage) {
    /**
     * Exchange configuration
     * @type {BinanceConfig}
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
   * Establishes WebSocket connection to Binance
   *
   * Sets up event handlers for:
   * - open: Connection established
   * - message: Incoming trade data
   * - error: Connection errors
   * - close: Connection closed (triggers reconnect)
   * - ping: Keepalive (responds with pong)
   *
   * @returns {void}
   */
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

  /**
   * Parses Binance-specific trade message format
   *
   * Binance trade stream format:
   * {
   *   e: 'trade',
   *   p: '45123.50',  // price
   *   q: '0.5',       // quantity
   *   T: 1705670123456 // timestamp
   * }
   *
   * @param {BinanceTradeMessage} data - Raw Binance trade message
   * @returns {Object|null} Normalized message or null if not a trade event
   * @private
   */
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

  /**
   * Reconnects to Binance with exponential backoff
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
    console.log(`[Binance] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

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

module.exports = BinanceExchange;
