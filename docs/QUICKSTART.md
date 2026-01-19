# Arbitrage Sniper - Quick Start Guide

## Overview

Get the arbitrage detection system running in under 5 minutes.

---

## Prerequisites

- Docker & Docker Compose
- 4GB RAM minimum
- Internet connection (for exchange WebSocket connections)

---

## Quick Start

### 1. Navigate to Project
```bash
cd arbitrage-sniper
```

### 2. Start All Services

**Option A: Using Makefile (Recommended)**
```bash
make up
```

**Option B: Using Docker Compose**
```bash
docker-compose up --build -d
```

### 3. Verify Services

**Option A: Using health check script**
```bash
./health-check.sh
```

**Option B: Manual checks**
```bash
# Ingestor
curl http://localhost:8080/health

# Dashboard API
curl http://localhost:3000/api/health

# Redis
docker exec arbitrage-redis redis-cli ping
```

**Option C: Using Makefile**
```bash
make health
```

### 4. Open Dashboard

Navigate to: **http://localhost:3000**

You should see:
- Live connection status (green when connected)
- Real-time statistics (latest spread, best opportunity, total signals)
- Live signal feed from Binance and Coinbase
- Arbitrage signals when spread > 0.5%

---

## Expected Output

### Terminal (docker-compose logs)

**Ingestor:**
```
arbitrage-ingestor  | === Arbitrage Sniper - Ingestor ===
arbitrage-ingestor  | Starting WebSocket gateway...
arbitrage-ingestor  |
arbitrage-ingestor  | [ZMQ] Publisher bound to tcp://0.0.0.0:5555
arbitrage-ingestor  | [Binance] Connecting...
arbitrage-ingestor  | [Coinbase] Connecting...
arbitrage-ingestor  | [Binance] Connected
arbitrage-ingestor  | [Coinbase] Connected
arbitrage-ingestor  |
arbitrage-ingestor  | [Health] HTTP server listening on port 8080
```

**Quant Engine:**
```
arbitrage-quant     | === Arbitrage Sniper - Quant Engine ===
arbitrage-quant     | Spread Threshold: 0.5%
arbitrage-quant     | Symbols: ['BTC/USDT']
arbitrage-quant     |
arbitrage-quant     | [Redis] Connected to Redis<ConnectionPool<...>>
arbitrage-quant     | [ZMQ] Connected to tcp://ingestor:5555
arbitrage-quant     | [ZMQ] Starting receive loop...
arbitrage-quant     | [Engine] Processing market data...
```

**Dashboard:**
```
arbitrage-dashboard | === Arbitrage Sniper - Dashboard ===
arbitrage-dashboard | Redis: redis://redis:6379
arbitrage-dashboard | Port: 3000
arbitrage-dashboard |
arbitrage-dashboard | [Server] Dashboard running on http://localhost:3000
arbitrage-dashboard |
arbitrage-dashboard | [Redis] Subscriber connected
arbitrage-dashboard | [Redis] Subscribed to arbitrage:signals
```

### Live Signal Example

When an arbitrage opportunity is detected, you'll see in the quant engine logs:
```
arbitrage-quant | [SIGNAL] BUY_BINANCE_SELL_COINBASE @ 0.75% (Profit: $338.25)
```

And in the dashboard UI:
```
BUY_BINANCE_SELL_COINBASE
Spread: 0.75%
Buy Price: $45,100.00
Sell Price: $45,438.25
Estimated Profit: $338.25
10:15:23 AM
```

---

## Troubleshooting

### Issue: Services won't start

**Check logs:**
```bash
docker-compose logs ingestor
docker-compose logs quant_engine
```

**Common causes:**
- Port conflicts (3000, 6379, 8080, 5555 already in use)
- Docker not running
- Insufficient memory

**Solution:**
```bash
# Stop conflicting services
lsof -ti:3000 | xargs kill -9

# Restart Docker
sudo systemctl restart docker

# Try again
docker-compose down && docker-compose up --build
```

### Issue: No signals appearing

**Possible reasons:**
1. Spread threshold too high (default 0.5%)
2. Market conditions (no arbitrage opportunities)
3. Exchange connection issues

**Check exchange connections:**
```bash
curl http://localhost:8080/health
```

Should show:
```json
{
  "status": "ok",
  "websockets": {
    "binance": {"connected": true},
    "coinbase": {"connected": true}
  },
  "zmq": {
    "messages_sent": 15234
  }
}
```

**Lower threshold (for testing):**
Edit `docker-compose.yml`:
```yaml
quant_engine:
  environment:
    - SPREAD_THRESHOLD_PCT=0.1  # Lower to 0.1%
```

Then restart:
```bash
docker-compose restart quant_engine
```

### Issue: Dashboard not loading

**Check if container is running:**
```bash
docker ps | grep dashboard
```

**Check logs:**
```bash
docker-compose logs dashboard
```

**Restart dashboard:**
```bash
docker-compose restart dashboard
```

---

## Configuration

### Environment Variables

**Ingestor (.env):**
```bash
ZMQ_ENDPOINT=tcp://0.0.0.0:5555
BINANCE_ENABLED=true
COINBASE_ENABLED=true
HEALTH_PORT=8080
LOG_LEVEL=info
```

**Quant Engine (.env):**
```bash
ZMQ_ENDPOINT=tcp://ingestor:5555
REDIS_URL=redis://redis:6379
SPREAD_THRESHOLD_PCT=0.5
SYMBOLS=BTC/USDT
```

**Dashboard (.env):**
```bash
REDIS_URL=redis://redis:6379
PORT=3000
```

---

## Development Mode

### Run Individual Services

**Ingestor:**
```bash
cd services/ingestor
npm install
npm start
```

**Quant Engine:**
```bash
cd services/quant_engine
pip install -r requirements.txt
python src/main.py
```

**Dashboard:**
```bash
cd services/dashboard
npm install
npm start
```

### Watch Logs

**Using Makefile:**
```bash
make logs
```

**Using Docker Compose:**
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f quant_engine

# Last 100 lines
docker-compose logs --tail=100 ingestor
```

### Monitor Redis

```bash
# Enter Redis CLI
docker exec -it arbitrage-redis redis-cli

# Subscribe to signals channel
SUBSCRIBE arbitrage:signals

# View signal history
ZRANGE signals:history -10 -1

# Check stored keys
KEYS *
```

---

## Performance Testing

### 1. Check Latency

**Monitor logs for timing:**
```bash
docker-compose logs -f quant_engine | grep "latency"
```

Expected: <5ms end-to-end

### 2. Message Throughput

```bash
# Check ZMQ message count
curl http://localhost:8080/health | jq '.zmq.messages_sent'

# Wait 10 seconds
sleep 10

# Check again (should increase)
curl http://localhost:8080/health | jq '.zmq.messages_sent'
```

Expected: 10-50 messages/second per exchange

### 3. Memory Usage

```bash
docker stats arbitrage-quant arbitrage-ingestor
```

Expected:
- Ingestor: <100MB
- Quant Engine: <150MB
- Dashboard: <80MB
- Redis: <50MB

---

## Useful Commands

### Using Makefile

```bash
make help      # Show all available commands
make up        # Start all services
make down      # Stop all services
make restart   # Restart all services
make logs      # View logs (all services)
make health    # Run health check
make clean     # Remove all containers and images
```

### Using Docker Compose

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

---

## Stopping Services

### Graceful Shutdown

**Using Makefile:**
```bash
make down
```

**Using Docker Compose:**
```bash
docker-compose down
```

### Force Stop (if hanging)
```bash
docker-compose down --timeout 5

# If still running
docker-compose kill
```

### Clean Up Everything

**Using Makefile:**
```bash
make clean
```

**Using Docker Compose:**
```bash
# Stop and remove containers + volumes
docker-compose down -v

# Remove images
docker-compose down --rmi all
```

---

## Project Structure Reference

```
arbitrage-sniper/
├── services/
│   ├── ingestor/         # Node.js WebSocket gateway
│   ├── quant_engine/     # Python arbitrage detector
│   └── dashboard/        # Real-time web dashboard
├── docs/                 # Full documentation
├── docker-compose.yml    # Service orchestration
├── Makefile             # Convenient commands
├── health-check.sh      # Health check script
└── README.md            # Main documentation
```

## Next Steps

1. **Read Full Documentation**
   - [README.md](../README.md) - Complete project overview
   - [ARCHITECTURE.md](./ARCHITECTURE.md) - System design details
   - [SERVICE_RESPONSIBILITIES.md](./SERVICE_RESPONSIBILITIES.md) - Implementation guide
   - [DATA_FLOW.md](./DATA_FLOW.md) - Message formats and pipeline

2. **Customize Configuration**
   - Adjust spread threshold in `docker-compose.yml`
   - Add more exchanges (modify `services/ingestor/src/config.js`)
   - Change symbols (update environment variables)

3. **Enhance Dashboard**
   - Customize UI in `services/dashboard/src/public/`
   - Add charts (Chart.js, Recharts)
   - Show historical spreads
   - Display order book depth

4. **Add Monitoring**
   - Implement Prometheus metrics endpoint
   - Create Grafana dashboards
   - Add alert notifications (Discord, Telegram)

5. **Optimize Performance**
   - Profile hot paths
   - Add caching layers
   - Tune ZeroMQ parameters
   - Implement load testing

---

## Support

### Logs Location
```bash
# Container logs
docker-compose logs > logs.txt

# Service-specific
docker-compose logs ingestor > ingestor.txt
```

### Health Check Summary

The project includes a health check script. Run it with:

```bash
./health-check.sh
```

Or use the Makefile:
```bash
make health
```

This will check:
- ✓ Ingestor health and WebSocket connections
- ✓ Dashboard health and Redis connectivity
- ✓ Redis availability
- ✓ Container status
- ✓ Recent arbitrage signals

---

**Document Version:** 1.0
**Last Updated:** 2026-01-19
