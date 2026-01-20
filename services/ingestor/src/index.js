/**
 * @fileoverview Main entry point for the Arbitrage Sniper Ingestor service
 *
 * This service acts as a WebSocket gateway that:
 * 1. Connects to multiple cryptocurrency exchanges (Binance, Coinbase)
 * 2. Normalizes incoming market data to a unified format
 * 3. Publishes normalized data to the Python quant engine via ZeroMQ
 * 4. Provides health check and metrics endpoints
 *
 * Architecture:
 * - Ultra-low-latency: <1ms processing time
 * - Non-blocking async I/O
 * - Auto-reconnection with exponential backoff
 * - Graceful shutdown handling
 *
 * @module index
 * @requires express
 * @requires ./config
 * @requires ./zmq_publisher
 * @requires ./exchanges/binance
 * @requires ./exchanges/coinbase
 * @requires ./normalizer
 */

const express = require('express');
const config = require('./config');
const ZMQPublisher = require('./zmq_publisher');
const BinanceExchange = require('./exchanges/binance');
const CoinbaseExchange = require('./exchanges/coinbase');
const { normalizeMessage } = require('./normalizer');

console.log('=== Arbitrage Sniper - Ingestor ===');
console.log('Starting WebSocket gateway...\n');

/**
 * ZeroMQ publisher instance for sending data to quant engine
 * @type {ZMQPublisher}
 */
const zmqPublisher = new ZMQPublisher(config.zmq.endpoint);

/**
 * Active exchange connections
 * @type {Object.<string, (BinanceExchange|CoinbaseExchange)>}
 */
const exchanges = {};

/**
 * Handles incoming messages from exchange WebSockets
 *
 * Processing pipeline:
 * 1. Normalize exchange-specific format
 * 2. Validate normalized data
 * 3. Send via ZeroMQ to quant engine
 * 4. Log if debug mode enabled
 *
 * @async
 * @param {Object} rawMessage - Raw message from exchange
 * @param {string} rawMessage.exchange - Exchange identifier
 * @returns {Promise<void>}
 * @private
 */
async function handleExchangeMessage(rawMessage) {
  const normalized = normalizeMessage(rawMessage.exchange, rawMessage);

  if (normalized) {
    const sent = await zmqPublisher.send(normalized);
    if (sent && config.logLevel === 'debug') {
      console.log(`[${normalized.exchange}] Price: ${normalized.price}`);
    }
  }
}

/**
 * Initializes and connects to all enabled exchanges
 *
 * Creates exchange instances based on configuration and establishes
 * WebSocket connections. Each exchange will auto-reconnect on disconnect.
 *
 * @returns {void}
 * @private
 */
function startExchanges() {
  if (config.exchanges.binance.enabled) {
    exchanges.binance = new BinanceExchange(
      config.exchanges.binance,
      handleExchangeMessage
    );
    exchanges.binance.connect();
  }

  if (config.exchanges.coinbase.enabled) {
    exchanges.coinbase = new CoinbaseExchange(
      config.exchanges.coinbase,
      handleExchangeMessage
    );
    exchanges.coinbase.connect();
  }
}

/**
 * Async initialization
 * Binds ZeroMQ socket before starting exchange connections
 */
(async () => {
  // Bind ZMQ socket
  if (!await zmqPublisher.bind()) {
    console.error('Failed to bind ZMQ socket. Exiting.');
    process.exit(1);
  }

  // Start exchanges after ZMQ is ready
  startExchanges();
})();

/**
 * Express application for health checks and metrics
 * @type {Express}
 */
const app = express();

/**
 * GET /health
 * Health check endpoint
 *
 * Returns system status including:
 * - Overall status
 * - WebSocket connection states
 * - ZeroMQ statistics
 * - Process uptime
 *
 * @route GET /health
 * @returns {Object} 200 - Health status object
 * @returns {string} status - Overall status ('ok')
 * @returns {Object} websockets - WebSocket connection statuses
 * @returns {Object} zmq - ZeroMQ statistics
 * @returns {number} uptime - Process uptime in seconds
 */
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    websockets: {},
    zmq: zmqPublisher.getStats(),
    uptime: process.uptime()
  };

  Object.keys(exchanges).forEach(name => {
    health.websockets[name] = {
      connected: exchanges[name].isConnected,
      reconnect_attempts: exchanges[name].reconnectAttempts
    };
  });

  res.json(health);
});

/**
 * GET /metrics
 * Prometheus-compatible metrics endpoint
 *
 * Exports metrics in Prometheus text format:
 * - ws_messages_sent: Total messages sent via ZeroMQ
 * - ws_errors: Total ZeroMQ send errors
 *
 * @route GET /metrics
 * @returns {string} 200 - Prometheus-format metrics (text/plain)
 */
app.get('/metrics', (req, res) => {
  const stats = zmqPublisher.getStats();
  res.type('text/plain');
  res.send(`# HELP ws_messages_sent Total messages sent via ZMQ
# TYPE ws_messages_sent counter
ws_messages_sent ${stats.messages_sent}

# HELP ws_errors Total ZMQ send errors
# TYPE ws_errors counter
ws_errors ${stats.errors}
`);
});

/**
 * HTTP server instance for health checks
 * @type {Server}
 */
const server = app.listen(config.health.port, () => {
  console.log(`\n[Health] HTTP server listening on port ${config.health.port}`);
  console.log(`[Health] GET http://localhost:${config.health.port}/health`);
  console.log(`[Health] GET http://localhost:${config.health.port}/metrics\n`);
});

/**
 * Graceful shutdown handler
 *
 * Closes all connections in order:
 * 1. Exchange WebSockets
 * 2. ZeroMQ socket
 * 3. HTTP server
 *
 * @private
 * @returns {void}
 */
function gracefulShutdown() {
  console.log('\nShutting down gracefully...');

  // Close all exchange connections
  Object.values(exchanges).forEach(exchange => exchange.close());

  // Close ZeroMQ publisher
  zmqPublisher.close();

  // Close HTTP server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
