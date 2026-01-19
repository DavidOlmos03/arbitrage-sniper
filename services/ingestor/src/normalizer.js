/**
 * Normalizes exchange-specific message formats to unified schema
 */

function normalizeMessage(exchange, rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'object') {
    return null;
  }

  const price = parseFloat(rawMessage.price);

  if (isNaN(price) || price <= 0) {
    console.warn(`[${exchange}] Invalid price:`, rawMessage);
    return null;
  }

  const timestamp = rawMessage.timestamp || Date.now();
  const now = Date.now();

  // Reject messages older than 60 seconds
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
