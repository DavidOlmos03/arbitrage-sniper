/**
 * @fileoverview Configuration module for the Arbitrage Sniper Ingestor
 * Loads environment variables and provides centralized configuration
 * @module config
 */

require('dotenv').config();

/**
 * @typedef {Object} ZMQConfig
 * @property {string} endpoint - ZeroMQ endpoint address
 */

/**
 * @typedef {Object} ExchangeConfig
 * @property {boolean} enabled - Whether the exchange is enabled
 * @property {string} url - WebSocket URL for the exchange
 * @property {string} name - Exchange identifier
 */

/**
 * @typedef {Object} HealthConfig
 * @property {number} port - HTTP port for health check server
 */

/**
 * @typedef {Object} Config
 * @property {ZMQConfig} zmq - ZeroMQ configuration
 * @property {Object.<string, ExchangeConfig>} exchanges - Exchange configurations
 * @property {HealthConfig} health - Health check server configuration
 * @property {string} logLevel - Logging level (debug|info|warn|error)
 */

/**
 * Application configuration object
 * @type {Config}
 */
const config = {
  zmq: {
    endpoint: process.env.ZMQ_ENDPOINT || 'tcp://0.0.0.0:5555'
  },
  exchanges: {
    binance: {
      enabled: process.env.BINANCE_ENABLED !== 'false',
      url: 'wss://stream.binance.com:443/ws/btcusdt@trade',
      name: 'binance'
    },
    coinbase: {
      enabled: process.env.COINBASE_ENABLED !== 'false',
      url: 'wss://ws-feed.exchange.coinbase.com',
      name: 'coinbase'
    }
  },
  health: {
    port: parseInt(process.env.HEALTH_PORT || '8080')
  },
  logLevel: process.env.LOG_LEVEL || 'info'
};

module.exports = config;
