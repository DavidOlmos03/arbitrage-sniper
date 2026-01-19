# Arbitrage Sniper - System Architecture

## Overview

A minimal, high-performance arbitrage detection engine designed for <5ms internal latency. This system uses a hybrid Node.js/Python architecture optimized for real-time cryptocurrency market data processing.

**Design Principles:**
- **Simplicity**: Single responsibility per service
- **Low Latency**: Zero-copy IPC, in-memory processing
- **Fault Tolerance**: Auto-reconnection, graceful degradation
- **Hackathon Ready**: Fast to build, easy to understand

---

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Exchange APIs (Binance, Coinbase, etc.)                        │
│         │                    │                                   │
│         │ WebSocket          │ WebSocket                         │
│         ▼                    ▼                                   │
│  ┌──────────────────────────────────────┐                       │
│  │   Node.js Ingestor (Gateway)         │                       │
│  │   - WebSocket connections             │                       │
│  │   - Data normalization                │                       │
│  │   - Connection management             │                       │
│  └──────────────┬───────────────────────┘                       │
│                 │                                                │
│                 │ ZeroMQ PUSH (TCP)                              │
│                 │ {exchange, price, volume, timestamp}           │
│                 ▼                                                │
│  ┌──────────────────────────────────────┐                       │
│  │   Python Quant Engine                │                       │
│  │   - asyncio + uvloop                  │                       │
│  │   - In-memory order book              │                       │
│  │   - Spread calculation                │                       │
│  │   - Signal generation                 │                       │
│  └──────────────┬───────────────────────┘                       │
│                 │                                                │
│                 │ Redis PUBLISH                                  │
│                 │ {signal: "BUY_A_SELL_B", spread: 0.75%}       │
│                 ▼                                                │
│  ┌──────────────────────────────────────┐                       │
│  │   Redis (Signal Bus + Cache)         │                       │
│  │   - PUB/SUB for signals               │                       │
│  │   - Cache latest prices               │                       │
│  │   - Store signal history              │                       │
│  └──────────────┬───────────────────────┘                       │
│                 │                                                │
│                 │ Redis SUBSCRIBE                                │
│                 ▼                                                │
│  ┌──────────────────────────────────────┐                       │
│  │   Node.js Dashboard Server           │                       │
│  │   - Socket.io for frontend            │                       │
│  │   - Real-time signal broadcast        │                       │
│  └──────────────┬───────────────────────┘                       │
│                 │                                                │
│                 │ Socket.io                                      │
│                 ▼                                                │
│  ┌──────────────────────────────────────┐                       │
│  │   Frontend Dashboard (Browser)        │                       │
│  │   - Live price feed                   │                       │
│  │   - Arbitrage signals                 │                       │
│  │   - Spread visualization              │                       │
│  └──────────────────────────────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Market Data Ingestion (Hot Path)
```
Exchange WebSocket → Node.js Parser → ZeroMQ → Python Engine
                                                      ↓
                                              In-Memory Order Book
```

**Latency Target:** <2ms from receive to ZMQ send

**Message Format:**
```json
{
  "exchange": "binance",
  "symbol": "BTC/USDT",
  "price": 45123.50,
  "volume": 0.5,
  "timestamp": 1705670123456,
  "type": "trade"
}
```

### 2. Arbitrage Detection (Critical Path)
```
ZeroMQ Receive → Order Book Update → Spread Calc → Signal Decision
     ↓                                                    ↓
 <0.5ms                                          Redis PUBLISH
```

**Latency Target:** <3ms from ZMQ receive to Redis publish

**Signal Format:**
```json
{
  "type": "ARBITRAGE_OPPORTUNITY",
  "action": "BUY_BINANCE_SELL_COINBASE",
  "spread_pct": 0.75,
  "buy_price": 45100.00,
  "sell_price": 45438.25,
  "timestamp": 1705670123459,
  "profit_estimate": 338.25
}
```

### 3. Signal Distribution (Cold Path)
```
Redis PUB → Node.js Subscriber → Socket.io → Frontend
```

**Latency Target:** <100ms (user-facing, non-critical)

---

## Service Responsibilities

### Service 1: Node.js Ingestor (`services/ingestor/`)

**Primary Role:** High-performance WebSocket gateway

**Responsibilities:**
- Maintain persistent WebSocket connections to exchanges
- Handle reconnection with exponential backoff
- Normalize exchange-specific data formats to unified schema
- Forward to Python via ZeroMQ PUSH socket
- Emit connection health metrics

**Key Constraints:**
- **Non-blocking:** Use async/await for all I/O
- **Stateless:** No business logic, pure data forwarding
- **Resilient:** Auto-reconnect on disconnect

**Technology Stack:**
- `ws` or `ccxt` for WebSocket connections
- `zeromq` (zmq package) for IPC
- Event-driven architecture

**Configuration:**
```javascript
{
  exchanges: ['binance', 'coinbase'],
  symbols: ['BTC/USDT'],
  zmq: {
    endpoint: 'tcp://127.0.0.1:5555',
    type: 'PUSH'
  }
}
```

---

### Service 2: Python Quant Engine (`services/quant_engine/`)

**Primary Role:** Ultra-low-latency arbitrage detection

**Responsibilities:**
- Receive market data from ZeroMQ PULL socket
- Maintain in-memory order book (best bid/ask only)
- Calculate cross-exchange spread in real-time
- Generate signals when spread > threshold
- Publish signals to Redis

**Key Constraints:**
- **Performance:** Use `uvloop` for 2-4x event loop speedup
- **Memory Efficient:** Keep only latest prices (no historical data)
- **Async:** All operations non-blocking

**Technology Stack:**
- `asyncio` + `uvloop` for event loop
- `pyzmq` for ZeroMQ
- `redis-py` with async support
- `orjson` for fast JSON parsing

**Core Algorithm:**
```python
# Simplified spread calculation
spread = (exchange_B_ask - exchange_A_bid) / exchange_A_bid * 100

if spread > THRESHOLD:
    signal = {
        'action': 'BUY_A_SELL_B',
        'spread_pct': spread,
        ...
    }
    await redis.publish('arbitrage:signals', signal)
```

**Configuration:**
```python
{
    'zmq_pull_endpoint': 'tcp://127.0.0.1:5555',
    'redis_url': 'redis://localhost:6379',
    'spread_threshold_pct': 0.5,
    'signal_channel': 'arbitrage:signals'
}
```

---

### Service 3: Redis (`infrastructure/redis/`)

**Primary Role:** Signal bus and fast cache

**Responsibilities:**
- PUB/SUB for signal distribution
- Cache latest prices (TTL: 10s)
- Store signal history (ZSET, scored by timestamp)
- Provide health check endpoint

**Key Constraints:**
- **In-Memory Only:** No disk persistence (speed priority)
- **Single Instance:** No cluster complexity for hackathon

**Data Structures:**
```
# Channels
arbitrage:signals (PUB/SUB)

# Keys
price:binance:BTC/USDT → {price, timestamp} (TTL: 10s)
price:coinbase:BTC/USDT → {price, timestamp} (TTL: 10s)
signals:history → ZSET (score: timestamp)
```

---

### Service 4: Dashboard Server (`services/dashboard/`)

**Primary Role:** Real-time frontend communication

**Responsibilities:**
- Subscribe to Redis signal channel
- Broadcast signals to connected WebSocket clients
- Serve static dashboard files
- Provide REST API for signal history

**Key Constraints:**
- **Lightweight:** Express + Socket.io only
- **Read-Only:** No write operations to Redis

**Endpoints:**
```
WS  /socket.io           → Real-time signal stream
GET /api/signals/latest  → Last 50 signals
GET /api/health          → System health
GET /                    → Dashboard HTML
```

---

## Inter-Process Communication

### ZeroMQ: Node.js → Python (Market Data)

**Pattern:** PUSH/PULL (Fan-out, load-balanced)

**Why ZeroMQ:**
- Zero-copy message passing
- ~10x faster than HTTP
- Built-in reconnection
- No broker overhead

**Configuration:**
```javascript
// Ingestor (PUSH)
const sock = zmq.socket('push');
sock.bindSync('tcp://127.0.0.1:5555');

// Python (PULL)
socket = zmq.asyncio.Context().socket(zmq.PULL)
socket.connect('tcp://127.0.0.1:5555')
```

### Redis PUB/SUB: Python → Dashboard (Signals)

**Pattern:** Publish/Subscribe (Fan-out broadcast)

**Why Redis:**
- Built-in PUB/SUB
- Atomic operations
- Familiar developer experience
- Bonus: Can store signal history

**Configuration:**
```python
# Python Publisher
await redis.publish('arbitrage:signals', json.dumps(signal))

// Node.js Subscriber
redisClient.subscribe('arbitrage:signals');
redisClient.on('message', (channel, message) => {
  io.emit('signal', JSON.parse(message));
});
```

---

## Performance Optimizations

### Latency Budget Breakdown

| Stage | Target | Optimization |
|-------|--------|--------------|
| WS Receive → Parse | <0.5ms | Minimal validation, pre-allocated buffers |
| ZMQ Send | <0.3ms | msgpack encoding, local TCP |
| ZMQ Receive → Book Update | <0.5ms | Lock-free data structures |
| Spread Calc | <0.1ms | Simple arithmetic, no DB lookup |
| Signal Publish | <1ms | Redis pipeline, fire-and-forget |
| **Total (Hot Path)** | **<2.4ms** | **Well under 5ms target** |

### Memory Management

**Node.js:**
- Object pooling for market data messages
- Limit event listener count
- Disable V8 optimizer de-opts with `--max-old-space-size=512`

**Python:**
- `__slots__` for order book entries
- `collections.deque` with `maxlen` for ring buffers
- Disable garbage collection during hot path

### Error Handling

**Fail Fast Philosophy:**
- Invalid data → Log + drop (don't block pipeline)
- ZMQ disconnect → Reconnect with backoff
- Redis down → Buffer signals in memory (max 1000)

---

## Deployment (Docker Compose)

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    command: redis-server --save "" --appendonly no

  ingestor:
    build: ./services/ingestor
    depends_on: [redis]
    environment:
      ZMQ_ENDPOINT: tcp://0.0.0.0:5555

  quant_engine:
    build: ./services/quant_engine
    depends_on: [redis, ingestor]
    environment:
      ZMQ_ENDPOINT: tcp://ingestor:5555
      REDIS_URL: redis://redis:6379

  dashboard:
    build: ./services/dashboard
    depends_on: [redis]
    ports: ["3000:3000"]
    environment:
      REDIS_URL: redis://redis:6379
```

**Startup Order:**
1. Redis (0s)
2. Ingestor (2s - wait for Redis)
3. Quant Engine (5s - wait for ZMQ socket)
4. Dashboard (3s - wait for Redis)

---

## Monitoring & Observability

### Key Metrics

**Ingestor:**
- `ws.messages.received` (counter)
- `ws.reconnections` (counter)
- `zmq.send.latency` (histogram)

**Quant Engine:**
- `zmq.receive.latency` (histogram)
- `spread.calculation.latency` (histogram)
- `signals.generated` (counter)
- `orderbook.depth` (gauge)

**Dashboard:**
- `websocket.clients` (gauge)
- `signals.broadcast` (counter)

### Health Checks

```bash
# Ingestor
curl http://localhost:8080/health
# → {status: "ok", ws_connected: 2, zmq_sent: 15234}

# Quant Engine
curl http://localhost:8081/health
# → {status: "ok", messages_processed: 15230, signals: 3}

# Dashboard
curl http://localhost:3000/api/health
# → {status: "ok", clients: 2, redis_connected: true}
```

---

## Testing Strategy

### Unit Tests
- Data normalization logic
- Spread calculation
- Message serialization

### Integration Tests
- ZMQ message passing
- Redis PUB/SUB
- WebSocket reconnection

### Load Tests
- Simulate 1000 msg/sec from exchanges
- Verify <5ms end-to-end latency
- Check memory stability over 1 hour

### Acceptance Test
```
1. Start all services
2. Connect to Binance + Coinbase WS
3. Wait for price difference > 0.5%
4. Verify signal appears in dashboard <5ms
5. Check signal stored in Redis
```

---

## Future Enhancements (Out of Scope)

- ✗ Real order execution (keep it simulated)
- ✗ Multi-symbol support (adds complexity)
- ✗ Historical data storage (no DB requirement)
- ✗ Advanced order book depth (use best bid/ask only)
- ✗ Machine learning spread prediction (overkill)

---

## Appendix: Technology Justification

| Choice | Why | Alternative Considered |
|--------|-----|------------------------|
| Node.js for Ingestor | Native async I/O, rich WS libraries | Python (slower for I/O) |
| Python for Quant | NumPy compatibility, async maturity | Rust (overkill for hackathon) |
| ZeroMQ | Sub-millisecond IPC | gRPC (higher overhead) |
| Redis | Built-in PUB/SUB + cache | RabbitMQ (too heavy) |
| uvloop | 2-4x faster event loop | Standard asyncio (slower) |
| In-Memory Only | <5ms latency requirement | PostgreSQL (10-50ms writes) |

---

**Document Version:** 1.0
**Last Updated:** 2026-01-19
**Author:** Senior Backend Engineer
