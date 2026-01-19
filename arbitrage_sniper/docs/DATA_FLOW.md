# Data Flow - Arbitrage Sniper

## Overview

This document details the exact data flow through the system, including message formats, transformations, and timing constraints.

---

## Flow 1: Market Data Pipeline (Hot Path)

**End-to-End Latency Budget: <5ms**

### Step 1: Exchange WebSocket → Ingestor
**Time: 0ms** (external, network-bound)

**Raw Message Example (Binance):**
```json
{
  "e": "trade",
  "E": 1705670123456,
  "s": "BTCUSDT",
  "p": "45123.50",
  "q": "0.5",
  "T": 1705670123456
}
```

**Raw Message Example (Coinbase):**
```json
{
  "type": "ticker",
  "sequence": 12345,
  "product_id": "BTC-USD",
  "price": "45100.00",
  "time": "2024-01-19T10:15:23.456Z"
}
```

### Step 2: Ingestor Normalization
**Time: +0.3ms** (JSON parse + transform)

**Process:**
1. Parse JSON (native V8 parser)
2. Extract relevant fields
3. Normalize exchange-specific formats
4. Add metadata

**Normalized Message:**
```json
{
  "exchange": "binance",
  "symbol": "BTC/USDT",
  "price": 45123.50,
  "volume": 0.5,
  "timestamp": 1705670123456,
  "type": "trade",
  "raw_timestamp": 1705670123456,
  "normalized_at": 1705670123456
}
```

**Code Location:** `services/ingestor/src/normalizer.js`

### Step 3: Ingestor → ZeroMQ Send
**Time: +0.2ms** (serialize + send)

**Process:**
1. JSON.stringify (use `fast-json-stringify` for schema-based serialization)
2. ZeroMQ PUSH (non-blocking send)
3. No acknowledgment required

**Wire Format:** JSON string over TCP

**ZMQ Configuration:**
```javascript
{
  highWaterMark: 1000,  // Drop messages if consumer slow
  linger: 0,             // Don't wait on close
  sendTimeout: 1         // Fail fast if blocked
}
```

### Step 4: ZeroMQ → Python Quant Engine
**Time: +0.3ms** (network + receive)

**Process:**
1. ZeroMQ PULL receives bytes
2. Decode UTF-8
3. Parse JSON (use `orjson` - 2x faster than stdlib)

**Code Location:** `services/quant_engine/src/receiver.py`

```python
async def receive_market_data():
    while True:
        message_bytes = await socket.recv()
        data = orjson.loads(message_bytes)  # Fast parsing
        await process_tick(data)
```

### Step 5: Update In-Memory Order Book
**Time: +0.4ms** (data structure update)

**Order Book Structure:**
```python
# Simple two-level dict (exchange → symbol → best prices)
order_book = {
    'binance': {
        'BTC/USDT': {
            'bid': 45123.50,
            'ask': 45125.00,
            'timestamp': 1705670123456
        }
    },
    'coinbase': {
        'BTC/USDT': {
            'bid': 45100.00,
            'ask': 45102.50,
            'timestamp': 1705670123455
        }
    }
}
```

**Update Logic:**
```python
def update_book(exchange: str, symbol: str, price: float, ts: int):
    # Simplified: assume trade price is mid-point
    book[exchange][symbol]['bid'] = price - 0.01
    book[exchange][symbol]['ask'] = price + 0.01
    book[exchange][symbol]['timestamp'] = ts
```

**Note:** Real implementation would handle bid/ask separately via order book WebSocket streams.

### Step 6: Calculate Spread
**Time: +0.1ms** (simple arithmetic)

**Algorithm:**
```python
def calculate_cross_spread(symbol: str) -> dict:
    """
    Find best arbitrage opportunity across all exchange pairs.

    Returns: {
        'buy_exchange': str,
        'sell_exchange': str,
        'spread_pct': float,
        'profit_per_unit': float
    }
    """
    exchanges = list(order_book.keys())
    best_opp = None
    max_spread = 0

    for buy_ex in exchanges:
        for sell_ex in exchanges:
            if buy_ex == sell_ex:
                continue

            # Buy at lowest ask, sell at highest bid
            buy_price = order_book[buy_ex][symbol]['ask']
            sell_price = order_book[sell_ex][symbol]['bid']

            # Calculate spread percentage
            spread_pct = ((sell_price - buy_price) / buy_price) * 100

            if spread_pct > max_spread:
                max_spread = spread_pct
                best_opp = {
                    'buy_exchange': buy_ex,
                    'sell_exchange': sell_ex,
                    'buy_price': buy_price,
                    'sell_price': sell_price,
                    'spread_pct': spread_pct,
                    'profit_per_unit': sell_price - buy_price
                }

    return best_opp
```

### Step 7: Signal Decision
**Time: +0.05ms** (threshold check)

**Logic:**
```python
SPREAD_THRESHOLD = 0.5  # 0.5%

async def process_tick(data: dict):
    update_book(data['exchange'], data['symbol'], data['price'], data['timestamp'])

    opportunity = calculate_cross_spread(data['symbol'])

    if opportunity and opportunity['spread_pct'] > SPREAD_THRESHOLD:
        signal = {
            'type': 'ARBITRAGE_OPPORTUNITY',
            'action': f"BUY_{opportunity['buy_exchange'].upper()}_SELL_{opportunity['sell_exchange'].upper()}",
            'symbol': data['symbol'],
            'spread_pct': round(opportunity['spread_pct'], 4),
            'buy_price': opportunity['buy_price'],
            'sell_price': opportunity['sell_price'],
            'profit_estimate': opportunity['profit_per_unit'],
            'timestamp': int(time.time() * 1000),
            'detected_at': data['timestamp']
        }

        await publish_signal(signal)
```

### Step 8: Publish to Redis
**Time: +0.7ms** (serialize + network + Redis write)

**Process:**
```python
async def publish_signal(signal: dict):
    # Publish to PUB/SUB channel
    await redis.publish(
        'arbitrage:signals',
        orjson.dumps(signal).decode('utf-8')
    )

    # Store in sorted set (history)
    await redis.zadd(
        'signals:history',
        {orjson.dumps(signal).decode('utf-8'): signal['timestamp']}
    )

    # Keep only last 1000 signals
    await redis.zremrangebyrank('signals:history', 0, -1001)
```

**Total Hot Path Latency: ~2.0ms** ✓ (well under 5ms target)

---

## Flow 2: Signal Distribution (Cold Path)

**Latency Budget: <100ms** (user-facing, non-critical)

### Step 1: Redis PUB/SUB → Dashboard Server
**Time: ~5-10ms** (network + Node.js event loop)

**Code Location:** `services/dashboard/src/redis_subscriber.js`

```javascript
const subscriber = redis.duplicate();

subscriber.subscribe('arbitrage:signals', (err) => {
  if (err) console.error('Subscribe error:', err);
});

subscriber.on('message', (channel, message) => {
  const signal = JSON.parse(message);

  // Broadcast to all connected WebSocket clients
  io.emit('arbitrage:signal', signal);

  // Log for debugging
  console.log(`Signal: ${signal.action} @ ${signal.spread_pct}%`);
});
```

### Step 2: Dashboard → Frontend (Socket.io)
**Time: ~10-30ms** (network to browser)

**Socket.io Event:**
```javascript
// Server
io.emit('arbitrage:signal', signal);

// Client (browser)
socket.on('arbitrage:signal', (signal) => {
  updateDashboard(signal);
  playNotificationSound();
  highlightOpportunity(signal);
});
```

**Total Cold Path Latency: ~15-40ms** ✓

---

## Flow 3: Health Check & Metrics

### Ingestor Health Check
```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    websockets: {
      binance: binanceWs.isConnected,
      coinbase: coinbaseWs.isConnected
    },
    zmq: {
      endpoint: ZMQ_ENDPOINT,
      messages_sent: zmqMessageCounter
    },
    uptime: process.uptime()
  });
});
```

### Quant Engine Health Check
```python
@app.get('/health')
async def health():
    return {
        'status': 'ok',
        'zmq_connected': socket.closed == False,
        'messages_processed': message_counter,
        'signals_generated': signal_counter,
        'order_book_symbols': list(order_book.keys()),
        'uptime': time.time() - start_time
    }
```

---

## Data Validation & Error Handling

### Ingestor Validation

**Invalid Data Handling:**
```javascript
function normalizeMessage(exchange, rawMsg) {
  try {
    // Basic validation
    if (!rawMsg.price || isNaN(parseFloat(rawMsg.price))) {
      logger.warn('Invalid price', { exchange, rawMsg });
      return null;  // Drop message
    }

    if (!rawMsg.timestamp) {
      logger.warn('Missing timestamp', { exchange, rawMsg });
      return null;
    }

    // Normalize
    return {
      exchange,
      symbol: normalizeSymbol(rawMsg.symbol),
      price: parseFloat(rawMsg.price),
      volume: parseFloat(rawMsg.quantity || rawMsg.volume || 0),
      timestamp: parseInt(rawMsg.timestamp),
      type: rawMsg.type || 'trade'
    };
  } catch (err) {
    logger.error('Normalization error', { exchange, rawMsg, err });
    return null;
  }
}

// Send only valid messages
const normalized = normalizeMessage(exchange, rawMsg);
if (normalized) {
  zmqSocket.send(JSON.stringify(normalized));
}
```

### Quant Engine Validation

**Stale Data Detection:**
```python
MAX_PRICE_AGE_MS = 5000  # 5 seconds

def is_price_stale(timestamp: int) -> bool:
    age = (time.time() * 1000) - timestamp
    return age > MAX_PRICE_AGE_MS

def calculate_cross_spread(symbol: str) -> dict:
    # Skip exchanges with stale data
    valid_exchanges = [
        ex for ex in order_book.keys()
        if not is_price_stale(order_book[ex][symbol]['timestamp'])
    ]

    if len(valid_exchanges) < 2:
        return None  # Need at least 2 exchanges

    # ... rest of calculation
```

---

## Message Ordering & Race Conditions

### Problem: Out-of-Order Messages

**Scenario:**
```
Exchange A: Trade @ 45100 (t=1000)
Exchange A: Trade @ 45105 (t=1001)

# But received as:
t=1001 arrives first
t=1000 arrives second (network jitter)
```

**Solution: Timestamp-Based Ordering**
```python
def update_book(exchange: str, symbol: str, price: float, ts: int):
    current_ts = order_book.get(exchange, {}).get(symbol, {}).get('timestamp', 0)

    # Ignore older messages
    if ts < current_ts:
        logger.debug(f'Ignoring old message: {ts} < {current_ts}')
        return False

    # Update only if newer
    order_book[exchange][symbol] = {
        'bid': price - 0.01,
        'ask': price + 0.01,
        'timestamp': ts
    }
    return True
```

---

## Backpressure Handling

### Scenario: Quant Engine Can't Keep Up

**ZMQ Configuration:**
```javascript
// Ingestor (sender)
socket.setsockopt(zmq.ZMQ_SNDHWM, 1000);  // High water mark

// If queue full → drop oldest messages (prefer latest data)
```

**Python Receiver:**
```python
# Process messages in batches for efficiency
BATCH_SIZE = 10

async def receive_loop():
    batch = []

    while True:
        try:
            msg = await asyncio.wait_for(socket.recv(), timeout=0.01)
            batch.append(orjson.loads(msg))

            if len(batch) >= BATCH_SIZE:
                await process_batch(batch)
                batch = []
        except asyncio.TimeoutError:
            if batch:
                await process_batch(batch)
                batch = []
```

---

## Monitoring Data Flow

### Logging Strategy

**Ingestor:**
```javascript
// Log only important events (avoid hot path)
logger.info('WebSocket connected', { exchange });
logger.error('WebSocket error', { exchange, error });

// Metrics in-memory (expose via /metrics)
metrics.increment('ws.messages.received');
metrics.timing('zmq.send.latency', sendLatency);
```

**Quant Engine:**
```python
# Log signals only
logger.info(f"SIGNAL: {signal['action']} @ {signal['spread_pct']}%")

# Metrics
metrics.increment('messages.processed')
metrics.timing('spread.calculation.latency', calc_time)
```

### Prometheus Metrics (Optional)

```python
from prometheus_client import Counter, Histogram

messages_processed = Counter('messages_processed_total', 'Messages processed')
signal_latency = Histogram('signal_generation_latency_seconds', 'Signal latency')

async def process_tick(data: dict):
    start = time.time()

    # ... processing ...

    messages_processed.inc()
    signal_latency.observe(time.time() - start)
```

---

## Example: Complete Flow Trace

**Timestamp: 1705670123456**

```
[T+0ms]    Binance WS: BTC/USDT trade @ 45123.50
[T+0ms]    Coinbase WS: BTC/USD trade @ 45100.00

[T+0.3ms]  Ingestor: Normalized Binance → ZMQ
[T+0.5ms]  Ingestor: Normalized Coinbase → ZMQ

[T+0.8ms]  Quant: Received Binance tick
[T+1.0ms]  Quant: Updated order book
[T+1.1ms]  Quant: Received Coinbase tick
[T+1.3ms]  Quant: Updated order book

[T+1.4ms]  Quant: Calculated spread = 0.52%
[T+1.5ms]  Quant: Threshold exceeded → Generate signal

[T+2.2ms]  Redis: Signal published
[T+2.3ms]  Redis: Signal stored in history

[T+7ms]    Dashboard: Received signal via PUB/SUB
[T+8ms]    Dashboard: Broadcast to 3 WebSocket clients

[T+25ms]   Browser: Signal displayed in UI
```

**Total Latency (Exchange → UI): 25ms** ✓

---

**Document Version:** 1.0
**Last Updated:** 2026-01-19
