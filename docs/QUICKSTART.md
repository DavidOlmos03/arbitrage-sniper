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

### 1. Clone & Navigate
```bash
cd arbitrage-sniper
```

### 2. Start All Services
```bash
docker-compose up --build
```

### 3. Verify Services

**Check health endpoints:**
```bash
# Ingestor
curl http://localhost:8080/health

# Dashboard API
curl http://localhost:3000/api/health

# Redis
docker exec arbitrage-redis redis-cli ping
```

### 4. Open Dashboard

Navigate to: **http://localhost:3000**

You should see:
- Live connection status
- Real-time price feeds from Binance and Coinbase
- Arbitrage signals when spread > 0.5%

---

## Expected Output

### Terminal (docker-compose logs)

**Ingestor:**
```
arbitrage-ingestor  | Connected to binance WebSocket
arbitrage-ingestor  | Connected to coinbase WebSocket
arbitrage-ingestor  | ZMQ publisher bound to tcp://0.0.0.0:5555
arbitrage-ingestor  | Health server listening on port 8080
```

**Quant Engine:**
```
arbitrage-quant     | Quant Engine started with uvloop...
arbitrage-quant     | Connected to tcp://ingestor:5555
arbitrage-quant     | Redis publisher ready
```

**Dashboard:**
```
arbitrage-dashboard | Subscribed to arbitrage:signals
arbitrage-dashboard | Dashboard running on http://localhost:3000
```

### Dashboard UI

When an arbitrage opportunity is detected:
```
BUY_BINANCE_SELL_COINBASE
Spread: 0.75%
Profit: $338.25
10:15:23
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

## Stopping Services

### Graceful Shutdown
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
```bash
# Stop and remove containers + volumes
docker-compose down -v

# Remove images
docker-compose down --rmi all
```

---

## Next Steps

1. **Customize Configuration**
   - Adjust spread threshold
   - Add more exchanges (Kraken, FTX, etc.)
   - Change symbols (ETH/USDT, etc.)

2. **Enhance Dashboard**
   - Add charts (Chart.js, Recharts)
   - Show historical spreads
   - Display order book depth

3. **Add Monitoring**
   - Prometheus metrics
   - Grafana dashboards
   - Alert notifications (Discord, Telegram)

4. **Optimize Performance**
   - Profile hot paths
   - Add caching layers
   - Tune ZeroMQ parameters

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
```bash
#!/bin/bash
echo "=== Health Check ==="
echo "Ingestor:"
curl -s http://localhost:8080/health | jq

echo "\nDashboard:"
curl -s http://localhost:3000/api/health | jq

echo "\nRedis:"
docker exec arbitrage-redis redis-cli ping

echo "\nContainers:"
docker-compose ps
```

Save as `health-check.sh` and run:
```bash
chmod +x health-check.sh
./health-check.sh
```

---

**Document Version:** 1.0
**Last Updated:** 2026-01-19
