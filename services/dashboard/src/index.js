const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const redis = require('redis');
const path = require('path');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

console.log('=== Arbitrage Sniper - Dashboard ===');
console.log(`Redis: ${REDIS_URL}`);
console.log(`Port: ${PORT}\n`);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: Get signal history from Redis
app.get('/api/signals/history', async (req, res) => {
  const client = redis.createClient({ url: REDIS_URL });

  try {
    await client.connect();

    // Get last 50 signals from sorted set
    const signals = await client.zRange('signals:history', -50, -1);

    await client.quit();

    res.json(signals.map(s => JSON.parse(s)));
  } catch (error) {
    console.error('[API] Error fetching history:', error.message);
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// API: Health check
app.get('/api/health', async (req, res) => {
  const client = redis.createClient({ url: REDIS_URL });

  try {
    await client.connect();
    await client.ping();
    await client.quit();

    res.json({
      status: 'ok',
      redis_connected: true,
      websocket_clients: io.engine.clientsCount,
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      redis_connected: false,
      error: error.message
    });
  }
});

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`[WebSocket] Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[WebSocket] Client disconnected: ${socket.id}`);
  });

  socket.on('request_history', async () => {
    const client = redis.createClient({ url: REDIS_URL });

    try {
      await client.connect();
      const signals = await client.zRange('signals:history', -20, -1);
      await client.quit();

      socket.emit('history', signals.map(s => JSON.parse(s)));
    } catch (error) {
      console.error('[WebSocket] Error sending history:', error.message);
    }
  });
});

// Redis Subscriber for signals
const subscriber = redis.createClient({ url: REDIS_URL });

subscriber.on('error', (err) => {
  console.error('[Redis] Subscriber error:', err);
});

async function startSubscriber() {
  try {
    await subscriber.connect();
    console.log('[Redis] Subscriber connected');

    await subscriber.subscribe('arbitrage:signals', (message) => {
      try {
        const signal = JSON.parse(message);

        // Broadcast to all connected WebSocket clients
        io.emit('signal', signal);

        console.log(`[Signal] ${signal.action} @ ${signal.spread_pct}%`);
      } catch (error) {
        console.error('[Redis] Parse error:', error.message);
      }
    });

    console.log('[Redis] Subscribed to arbitrage:signals\n');
  } catch (error) {
    console.error('[Redis] Connection error:', error);
    process.exit(1);
  }
}

// Start server
httpServer.listen(PORT, () => {
  console.log(`[Server] Dashboard running on http://localhost:${PORT}\n`);
  startSubscriber();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\nSIGTERM received, shutting down...');
  await subscriber.quit();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT received, shutting down...');
  await subscriber.quit();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
