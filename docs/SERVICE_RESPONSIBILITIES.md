# Service Responsibilities - Implementation Guide

## Architecture Note

Based on the technical requirements, the system consists of **3 core services**:

1. **Node.js Ingestor** - WebSocket gateway + Dashboard server (combined)
2. **Python Quant Engine** - Arbitrage detection
3. **Redis** - Signal bus + cache

For better separation of concerns, we implement the Ingestor as **two separate processes** sharing the same Node.js codebase:
- **Ingestor Process**: Exchange WebSocket → ZeroMQ
- **Dashboard Process**: Redis subscriber → Socket.io frontend

This allows independent scaling and cleaner code organization while maintaining hackathon simplicity.

---

## Service 1: Node.js Ingestor

### Purpose
High-performance WebSocket gateway that connects to cryptocurrency exchanges and forwards normalized market data to the Python quant engine via ZeroMQ.

### File Structure
```
services/ingestor/
├── package.json
├── Dockerfile
├── .env.example
├── src/
│   ├── index.js              # Main entry point
│   ├── config.js             # Configuration loader
│   ├── exchanges/
│   │   ├── base.js           # Base exchange handler
│   │   ├── binance.js        # Binance WebSocket handler
│   │   └── coinbase.js       # Coinbase WebSocket handler
│   ├── normalizer.js         # Data normalization
│   ├── zmq_publisher.js      # ZeroMQ PUSH socket
│   └── server.js             # Health check HTTP server
└── tests/
    ├── normalizer.test.js
    └── exchanges.test.js
```

### Core Responsibilities

#### 1. Exchange WebSocket Connections

**Auto-Reconnection Strategy:**
- Exponential backoff: 1s → 2s → 4s → 8s → max 30s
- Reset backoff counter on successful connection
- Log all connection state changes
- Handle ping/pong for keepalive

**Implementation Pattern:**
```javascript
class ExchangeWebSocket {
  constructor(config) {
    this.config = config;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.isConnected = false;
  }

  connect() {
    this.ws = new WebSocket(this.config.url);

    this.ws.on('open', () => {
      console.log(`Connected to ${this.config.name}`);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.subscribe();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error(`Error: ${error.message}`);
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      this.reconnect();
    });
  }

  reconnect() {
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      30000
    );
    this.reconnectAttempts++;

    console.log(`Reconnecting in ${delay}ms...`);
    setTimeout(() => this.connect(), delay);
  }
}
```

#### 2. Data Normalization

**Unified Message Schema:**
```javascript
{
  exchange: string,      // "binance" | "coinbase"
  symbol: string,        // "BTC/USDT"
  price: number,         // 45123.50
  volume: number,        // 0.5 (optional)
  timestamp: number,     // Unix timestamp in milliseconds
  type: string           // "trade" | "ticker"
}
```

**Validation Rules:**
- Price must be positive number
- Timestamp must be within last 60 seconds
- Symbol must match expected format
- Drop invalid messages (log warning, don't crash)

#### 3. ZeroMQ Publishing

**Configuration:**
```javascript
const socket = zmq.socket('push');
socket.bindSync('tcp://0.0.0.0:5555');
socket.setsockopt(zmq.ZMQ_SNDHWM, 1000);  // High water mark
```

**Send Logic:**
```javascript
function publishToZMQ(normalizedData) {
  try {
    const message = JSON.stringify(normalizedData);
    socket.send(message);
    metrics.messagesSent++;
  } catch (error) {
    console.error('ZMQ send failed:', error);
  }
}
```

### Exchange-Specific Implementations

#### Binance
**WebSocket URL:** `wss://stream.binance.com:9443/ws/btcusdt@trade`

**Message Format:**
```json
{
  "e": "trade",
  "E": 1705670123456,
  "s": "BTCUSDT",
  "p": "45123.50",
  "q": "0.5"
}
```

**Parser:**
```javascript
parseBinanceMessage(raw) {
  const data = JSON.parse(raw);
  return {
    exchange: 'binance',
    symbol: 'BTC/USDT',
    price: parseFloat(data.p),
    volume: parseFloat(data.q),
    timestamp: data.E,
    type: 'trade'
  };
}
```

#### Coinbase
**WebSocket URL:** `wss://ws-feed.exchange.coinbase.com`

**Subscribe Message:**
```json
{
  "type": "subscribe",
  "product_ids": ["BTC-USD"],
  "channels": ["ticker"]
}
```

**Message Format:**
```json
{
  "type": "ticker",
  "product_id": "BTC-USD",
  "price": "45100.00",
  "time": "2024-01-19T10:15:23.456Z"
}
```

**Parser:**
```javascript
parseCoinbaseMessage(raw) {
  const data = JSON.parse(raw);
  if (data.type !== 'ticker') return null;

  return {
    exchange: 'coinbase',
    symbol: 'BTC/USDT',  // Normalize to same symbol
    price: parseFloat(data.price),
    volume: 0,
    timestamp: new Date(data.time).getTime(),
    type: 'ticker'
  };
}
```

### Configuration

**.env:**
```bash
# ZeroMQ
ZMQ_ENDPOINT=tcp://0.0.0.0:5555

# Exchanges
BINANCE_ENABLED=true
COINBASE_ENABLED=true

# Health
HEALTH_PORT=8080

# Logging
LOG_LEVEL=info
```

### Dependencies

**package.json:**
```json
{
  "name": "arbitrage-ingestor",
  "version": "1.0.0",
  "main": "src/index.js",
  "dependencies": {
    "ws": "^8.16.0",
    "zeromq": "^6.0.0-beta.19",
    "express": "^4.18.2",
    "dotenv": "^16.4.1"
  },
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js"
  }
}
```

### Performance Targets

- WebSocket message processing: <0.5ms
- ZeroMQ send: <0.3ms
- Total latency (WS receive → ZMQ send): <1ms
- Memory usage: <100MB

---

## Service 2: Python Quant Engine

### Purpose
Ultra-low-latency arbitrage detection engine using asyncio + uvloop.

### File Structure
```
services/quant_engine/
├── requirements.txt
├── Dockerfile
├── .env.example
├── src/
│   ├── main.py               # Entry point with uvloop
│   ├── config.py             # Configuration
│   ├── zmq_receiver.py       # ZeroMQ PULL socket
│   ├── order_book.py         # In-memory order book
│   ├── spread_engine.py      # Arbitrage detection
│   ├── redis_publisher.py    # Signal publisher
│   └── health_server.py      # Health check (optional FastAPI)
└── tests/
    ├── test_order_book.py
    └── test_spread.py
```

### Core Responsibilities

#### 1. ZeroMQ Message Receiver

**Implementation:**
```python
import zmq
import zmq.asyncio
import orjson

class ZMQReceiver:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.context = zmq.asyncio.Context()
        self.socket = self.context.socket(zmq.PULL)

    async def start(self, callback):
        self.socket.connect(self.endpoint)
        print(f"Connected to {self.endpoint}")

        while True:
            message = await self.socket.recv()
            data = orjson.loads(message)
            await callback(data)
```

**Performance:**
- Use `orjson` (2x faster than stdlib json)
- No message validation (trust Ingestor)
- Non-blocking async receive

#### 2. In-Memory Order Book

**Data Structure:**
```python
from dataclasses import dataclass
from typing import Dict

@dataclass
class PriceLevel:
    __slots__ = ('bid', 'ask', 'timestamp')
    bid: float
    ask: float
    timestamp: int

class OrderBook:
    def __init__(self):
        # {exchange: {symbol: PriceLevel}}
        self._book: Dict[str, Dict[str, PriceLevel]] = {}

    def update(self, exchange: str, symbol: str, price: float, ts: int):
        """Update with simplified bid/ask from trade price."""
        if exchange not in self._book:
            self._book[exchange] = {}

        # Simple spread approximation
        spread = price * 0.0001  # 0.01%
        self._book[exchange][symbol] = PriceLevel(
            bid=price - spread,
            ask=price + spread,
            timestamp=ts
        )

    def get_all(self, symbol: str) -> Dict[str, PriceLevel]:
        """Get all exchanges for symbol."""
        return {
            ex: book[symbol]
            for ex, book in self._book.items()
            if symbol in book
        }
```

**Optimizations:**
- `__slots__` to reduce memory by 40%
- No locks needed (single-threaded asyncio)
- Keep only latest price (no history)

#### 3. Spread Calculation & Signal Generation

**Core Algorithm:**
```python
from typing import Optional

class SpreadEngine:
    def __init__(self, threshold_pct: float = 0.5):
        self.threshold = threshold_pct

    def find_arbitrage(self, book: Dict[str, PriceLevel]) -> Optional[dict]:
        """
        Find best arbitrage opportunity.

        Strategy: Buy at lowest ask, sell at highest bid.
        """
        if len(book) < 2:
            return None

        best = None
        max_spread = 0.0

        exchanges = list(book.keys())
        for buy_ex in exchanges:
            for sell_ex in exchanges:
                if buy_ex == sell_ex:
                    continue

                buy_price = book[buy_ex].ask
                sell_price = book[sell_ex].bid

                spread_pct = ((sell_price - buy_price) / buy_price) * 100

                if spread_pct > max_spread:
                    max_spread = spread_pct
                    best = {
                        'buy_exchange': buy_ex,
                        'sell_exchange': sell_ex,
                        'buy_price': buy_price,
                        'sell_price': sell_price,
                        'spread_pct': round(spread_pct, 4),
                        'profit': round(sell_price - buy_price, 2)
                    }

        if best and best['spread_pct'] > self.threshold:
            return best

        return None
```

#### 4. Redis Signal Publisher

**Implementation:**
```python
from redis.asyncio import Redis
import orjson
import time

class SignalPublisher:
    def __init__(self, redis_url: str):
        self.redis = Redis.from_url(redis_url, decode_responses=False)
        self.channel = 'arbitrage:signals'

    async def publish_signal(self, opportunity: dict, symbol: str):
        """Publish signal to Redis PUB/SUB."""
        signal = {
            'type': 'ARBITRAGE_OPPORTUNITY',
            'action': f"BUY_{opportunity['buy_exchange'].upper()}_SELL_{opportunity['sell_exchange'].upper()}",
            'symbol': symbol,
            'spread_pct': opportunity['spread_pct'],
            'buy_price': opportunity['buy_price'],
            'sell_price': opportunity['sell_price'],
            'profit_estimate': opportunity['profit'],
            'timestamp': int(time.time() * 1000)
        }

        # Publish to channel
        signal_json = orjson.dumps(signal)
        await self.redis.publish(self.channel, signal_json)

        # Store in history (sorted set)
        await self.redis.zadd(
            'signals:history',
            {signal_json.decode(): signal['timestamp']}
        )

        # Keep only last 1000
        await self.redis.zremrangebyrank('signals:history', 0, -1001)

        print(f"SIGNAL: {signal['action']} @ {signal['spread_pct']}%")
```

#### 5. Main Loop with uvloop

**main.py:**
```python
import asyncio
import uvloop
from zmq_receiver import ZMQReceiver
from order_book import OrderBook
from spread_engine import SpreadEngine
from redis_publisher import SignalPublisher
from config import Config

# Install uvloop for 2-4x performance
asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())

async def main():
    # Initialize components
    config = Config.load()
    order_book = OrderBook()
    spread_engine = SpreadEngine(threshold_pct=config.spread_threshold)
    publisher = SignalPublisher(config.redis_url)
    receiver = ZMQReceiver(config.zmq_endpoint)

    # Message processor
    async def process_message(data: dict):
        # Update order book
        order_book.update(
            data['exchange'],
            data['symbol'],
            data['price'],
            data['timestamp']
        )

        # Check for arbitrage
        book_snapshot = order_book.get_all(data['symbol'])
        opportunity = spread_engine.find_arbitrage(book_snapshot)

        if opportunity:
            await publisher.publish_signal(opportunity, data['symbol'])

    # Start receiver loop
    print("Quant Engine started with uvloop...")
    await receiver.start(process_message)

if __name__ == '__main__':
    asyncio.run(main())
```

### Configuration

**.env:**
```bash
# ZeroMQ
ZMQ_ENDPOINT=tcp://ingestor:5555

# Redis
REDIS_URL=redis://redis:6379

# Strategy
SPREAD_THRESHOLD_PCT=0.5

# Symbols
SYMBOLS=BTC/USDT
```

### Dependencies

**requirements.txt:**
```
uvloop==0.19.0
pyzmq==25.1.2
redis[asyncio]==5.0.1
orjson==3.9.15
python-dotenv==1.0.0
```

### Performance Targets

- ZMQ receive → Order book update: <0.5ms
- Spread calculation: <0.1ms
- Redis publish: <1ms
- Total latency (ZMQ → Redis): <2ms

---

## Service 3: Dashboard Server (Node.js)

### Purpose
Real-time frontend communication via Socket.io, subscribing to Redis signals.

### File Structure
```
services/dashboard/
├── package.json
├── Dockerfile
├── src/
│   ├── index.js              # Express + Socket.io server
│   ├── redis_subscriber.js   # Redis PUB/SUB listener
│   └── public/
│       ├── index.html        # Dashboard UI
│       ├── style.css
│       └── app.js            # Frontend client
```

### Core Responsibilities

#### 1. Redis Subscriber

```javascript
const redis = require('redis');

class RedisSubscriber {
  constructor(redisUrl, socketIO) {
    this.subscriber = redis.createClient({ url: redisUrl });
    this.io = socketIO;
  }

  async start() {
    await this.subscriber.connect();

    await this.subscriber.subscribe('arbitrage:signals', (message) => {
      const signal = JSON.parse(message);

      // Broadcast to all connected clients
      this.io.emit('signal', signal);

      console.log(`Signal: ${signal.action} @ ${signal.spread_pct}%`);
    });

    console.log('Subscribed to arbitrage:signals');
  }
}
```

#### 2. Socket.io Server

```javascript
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const RedisSubscriber = require('./redis_subscriber');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Serve static files
app.use(express.static('public'));

// API: Signal history
app.get('/api/signals/history', async (req, res) => {
  const client = redis.createClient({ url: process.env.REDIS_URL });
  await client.connect();

  const signals = await client.zRange('signals:history', -50, -1);
  await client.quit();

  res.json(signals.map(s => JSON.parse(s)));
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start subscriber
const subscriber = new RedisSubscriber(process.env.REDIS_URL, io);
subscriber.start();

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
```

#### 3. Frontend (Minimal Dashboard)

**public/index.html:**
```html
<!DOCTYPE html>
<html>
<head>
  <title>Arbitrage Sniper</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body {
      font-family: monospace;
      background: #1a1a1a;
      color: #00ff00;
      padding: 20px;
    }
    .signal {
      padding: 10px;
      margin: 5px 0;
      background: #2a2a2a;
      border-left: 3px solid #00ff00;
    }
    .profit {
      color: #ffaa00;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <h1>Arbitrage Sniper - Live Signals</h1>
  <div id="signals"></div>

  <script>
    const socket = io();
    const signalsDiv = document.getElementById('signals');

    socket.on('signal', (signal) => {
      const div = document.createElement('div');
      div.className = 'signal';
      div.innerHTML = `
        <strong>${signal.action}</strong><br>
        Spread: ${signal.spread_pct}%<br>
        <span class="profit">Profit: $${signal.profit_estimate}</span><br>
        <small>${new Date(signal.timestamp).toLocaleTimeString()}</small>
      `;
      signalsDiv.insertBefore(div, signalsDiv.firstChild);

      // Keep only last 20
      while (signalsDiv.children.length > 20) {
        signalsDiv.removeChild(signalsDiv.lastChild);
      }
    });

    socket.on('connect', () => {
      console.log('Connected to dashboard');
    });
  </script>
</body>
</html>
```

### Dependencies

**package.json:**
```json
{
  "name": "arbitrage-dashboard",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.6.1",
    "redis": "^4.6.5",
    "dotenv": "^16.4.1"
  },
  "scripts": {
    "start": "node src/index.js"
  }
}
```

---

## Service 4: Redis

### Configuration

**Optimized for Speed (No Persistence):**
```conf
# redis.conf
save ""
appendonly no

maxmemory 256mb
maxmemory-policy allkeys-lru

bind 0.0.0.0
port 6379
```

### Data Structures

```bash
# PUB/SUB Channel
PUBLISH arbitrage:signals '{"type": "ARBITRAGE_OPPORTUNITY", ...}'

# Signal History (Sorted Set)
ZADD signals:history 1705670123456 '{"action": "BUY_BINANCE_SELL_COINBASE", ...}'

# Optional: Price Cache
SET price:binance:BTC/USDT '{"price": 45123.50}' EX 10
```

---

## Docker Compose Configuration

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: arbitrage-redis
    command: redis-server --save "" --appendonly no --maxmemory 256mb
    ports:
      - "6379:6379"
    networks:
      - arbitrage-net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  ingestor:
    build: ./services/ingestor
    container_name: arbitrage-ingestor
    depends_on:
      redis:
        condition: service_healthy
    environment:
      - ZMQ_ENDPOINT=tcp://0.0.0.0:5555
      - BINANCE_ENABLED=true
      - COINBASE_ENABLED=true
      - HEALTH_PORT=8080
    ports:
      - "8080:8080"
      - "5555:5555"
    networks:
      - arbitrage-net
    restart: unless-stopped

  quant_engine:
    build: ./services/quant_engine
    container_name: arbitrage-quant
    depends_on:
      - redis
      - ingestor
    environment:
      - ZMQ_ENDPOINT=tcp://ingestor:5555
      - REDIS_URL=redis://redis:6379
      - SPREAD_THRESHOLD_PCT=0.5
    networks:
      - arbitrage-net
    restart: unless-stopped

  dashboard:
    build: ./services/dashboard
    container_name: arbitrage-dashboard
    depends_on:
      - redis
    environment:
      - REDIS_URL=redis://redis:6379
      - PORT=3000
    ports:
      - "3000:3000"
    networks:
      - arbitrage-net
    restart: unless-stopped

networks:
  arbitrage-net:
    driver: bridge
```

---

## Deployment & Testing

### Startup
```bash
docker-compose up --build
```

### Health Checks
```bash
# Ingestor
curl http://localhost:8080/health

# Dashboard
curl http://localhost:3000/api/health

# Redis
redis-cli ping
```

### Access Dashboard
```
http://localhost:3000
```

---

**Document Version:** 1.0
**Last Updated:** 2026-01-19
