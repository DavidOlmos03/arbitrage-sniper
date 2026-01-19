require('dotenv').config();

const config = {
  zmq: {
    endpoint: process.env.ZMQ_ENDPOINT || 'tcp://0.0.0.0:5555'
  },
  exchanges: {
    binance: {
      enabled: process.env.BINANCE_ENABLED !== 'false',
      url: 'wss://stream.binance.com:9443/ws/btcusdt@trade',
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
