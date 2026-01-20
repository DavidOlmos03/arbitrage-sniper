/**
 * @fileoverview Data normalization module for exchange-specific message formats
 * Converts different exchange WebSocket message formats to a unified schema
 * @module normalizer
 */

/**
 * @typedef {Object} RawExchangeMessage
 * @property {string|number} price - Trade price from exchange
 * @property {string|number} [volume] - Trade volume
 * @property {number} [timestamp] - Exchange timestamp in milliseconds
 * @property {string} [type] - Message type (trade, ticker, etc.)
 */

/**
 * @typedef {Object} NormalizedMessage
 * @property {string} exchange - Exchange name (lowercase)
 * @property {string} symbol - Trading pair symbol (e.g., 'BTC/USDT')
 * @property {number} price - Trade price as float
 * @property {number} volume - Trade volume as float
 * @property {number} timestamp - Message timestamp in milliseconds
 * @property {string} type - Message type
 * @property {number} normalized_at - Normalization timestamp in milliseconds
 */

/**
 * Normalizes exchange-specific message formats to a unified schema
 *
 * Validation rules:
 * - Price must be a positive number
 * - Message must not be older than 60 seconds
 * - Raw message must be a valid object
 *
 * @param {string} exchange - Exchange identifier (e.g., 'binance', 'coinbase')
 * @param {RawExchangeMessage} rawMessage - Raw message from exchange WebSocket
 * @returns {NormalizedMessage|null} Normalized message or null if invalid
 *
 * @example
 * const normalized = normalizeMessage('binance', {
 *   price: '45123.50',
 *   volume: '0.5',
 *   timestamp: 1705670123456
 * });
 * // Returns: { exchange: 'binance', symbol: 'BTC/USDT', price: 45123.50, ... }
 */
function normalizeMessage(exchange, rawMessage) {
  // Validate input
  if (!rawMessage || typeof rawMessage !== 'object') {
    return null;
  }

  const price = parseFloat(rawMessage.price);

  // Validate price
  if (isNaN(price) || price <= 0) {
    console.warn(`[${exchange}] Invalid price:`, rawMessage);
    return null;
  }

  const timestamp = rawMessage.timestamp || Date.now();
  const now = Date.now();

  // Reject stale messages (older than 60 seconds)
  if (Math.abs(now - timestamp) > 60000) {
    console.warn(`[${exchange}] Stale message (${Math.abs(now - timestamp)}ms old)`);
    return null;
  }

  return {
    exchange: exchange.toLowerCase(),
    symbol: 'BTC/USDT',
    price: price,
    volume: parseFloat(rawMessage.volume || 0),
    timestamp: timestamp,
    type: rawMessage.type || 'trade',
    normalized_at: Date.now()
  };
}

module.exports = { normalizeMessage };
