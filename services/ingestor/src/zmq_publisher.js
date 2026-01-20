/**
 * @fileoverview ZeroMQ publisher for ultra-low-latency inter-process communication
 * Sends normalized market data to the Python quant engine
 * @module zmq_publisher
 */

const zmq = require('zeromq');

/**
 * @typedef {Object} ZMQStats
 * @property {number} messages_sent - Total messages successfully sent
 * @property {number} errors - Total send errors
 * @property {string} endpoint - ZeroMQ endpoint address
 */

/**
 * ZeroMQ publisher class for sending market data to quant engine
 *
 * Uses PUSH socket pattern for fan-out message distribution.
 * Implements high water mark to drop old messages if consumer is slow.
 *
 * @class
 * @example
 * const publisher = new ZMQPublisher('tcp://0.0.0.0:5555');
 * await publisher.bind();
 * await publisher.send({ exchange: 'binance', price: 45123.50 });
 */
class ZMQPublisher {
  /**
   * Creates a ZMQ publisher instance
   *
   * @param {string} endpoint - ZeroMQ endpoint (e.g., 'tcp://0.0.0.0:5555')
   */
  constructor(endpoint) {
    /**
     * ZeroMQ endpoint address
     * @type {string}
     * @private
     */
    this.endpoint = endpoint;

    /**
     * ZeroMQ PUSH socket
     * @type {Object}
     * @private
     */
    this.socket = new zmq.Push();

    /**
     * Counter for successfully sent messages
     * @type {number}
     * @private
     */
    this.messageCount = 0;

    /**
     * Counter for send errors
     * @type {number}
     * @private
     */
    this.errorCount = 0;

    /**
     * Socket bind status
     * @type {boolean}
     * @private
     */
    this.bound = false;
  }

  /**
   * Binds the ZeroMQ socket to the specified endpoint
   *
   * Sets high water mark to 1000 messages. If consumer can't keep up,
   * oldest messages will be dropped to maintain low latency.
   *
   * @async
   * @returns {Promise<boolean>} True if bind successful, false otherwise
   * @throws {Error} If endpoint is already in use
   */
  async bind() {
    try {
      await this.socket.bind(this.endpoint);
      this.socket.sendHighWaterMark = 1000; // Drop old messages if queue full
      this.bound = true;
      console.log(`[ZMQ] Publisher bound to ${this.endpoint}`);
      return true;
    } catch (error) {
      console.error('[ZMQ] Bind error:', error.message);
      return false;
    }
  }

  /**
   * Sends a message through the ZeroMQ socket
   *
   * Messages are JSON-serialized before sending.
   * If socket is not bound, message is rejected.
   *
   * @async
   * @param {Object} message - Message object to send (will be JSON stringified)
   * @returns {Promise<boolean>} True if sent successfully, false otherwise
   *
   * @example
   * await publisher.send({
   *   exchange: 'binance',
   *   symbol: 'BTC/USDT',
   *   price: 45123.50,
   *   timestamp: Date.now()
   * });
   */
  async send(message) {
    if (!this.bound) {
      return false;
    }

    try {
      const serialized = JSON.stringify(message);
      await this.socket.send(serialized);
      this.messageCount++;
      return true;
    } catch (error) {
      this.errorCount++;
      console.error('[ZMQ] Send error:', error.message);
      return false;
    }
  }

  /**
   * Gets publisher statistics
   *
   * @returns {ZMQStats} Statistics object with message counts and endpoint
   */
  getStats() {
    return {
      messages_sent: this.messageCount,
      errors: this.errorCount,
      endpoint: this.endpoint
    };
  }

  /**
   * Closes the ZeroMQ socket
   * Should be called during graceful shutdown
   *
   * @returns {void}
   */
  close() {
    this.socket.close();
  }
}

module.exports = ZMQPublisher;
