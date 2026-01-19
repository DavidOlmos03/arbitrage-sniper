const express = require('express');
const config = require('./config');
const ZMQPublisher = require('./zmq_publisher');
const BinanceExchange = require('./exchanges/binance');
const CoinbaseExchange = require('./exchanges/coinbase');
const { normalizeMessage } = require('./normalizer');

console.log('=== Arbitrage Sniper - Ingestor ===');
console.log('Starting WebSocket gateway...\n');

// Initialize ZeroMQ publisher
const zmqPublisher = new ZMQPublisher(config.zmq.endpoint);
if (!zmqPublisher.bind()) {
  console.error('Failed to bind ZMQ socket. Exiting.');
  process.exit(1);
}

// Exchange connections
const exchanges = {};

// Message handler
function handleExchangeMessage(rawMessage) {
  const normalized = normalizeMessage(rawMessage.exchange, rawMessage);

  if (normalized) {
    const sent = zmqPublisher.send(normalized);
    if (sent && config.logLevel === 'debug') {
      console.log(`[${normalized.exchange}] Price: ${normalized.price}`);
    }
  }
}

// Initialize exchanges
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

// Health check server
const app = express();

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

const server = app.listen(config.health.port, () => {
  console.log(`\n[Health] HTTP server listening on port ${config.health.port}`);
  console.log(`[Health] GET http://localhost:${config.health.port}/health`);
  console.log(`[Health] GET http://localhost:${config.health.port}/metrics\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nSIGTERM received, shutting down gracefully...');

  Object.values(exchanges).forEach(exchange => exchange.close());
  zmqPublisher.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');

  Object.values(exchanges).forEach(exchange => exchange.close());
  zmqPublisher.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
