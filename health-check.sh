#!/bin/bash

echo "=== Arbitrage Sniper - Health Check ==="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Ingestor
echo -n "Ingestor (8080): "
if curl -s http://localhost:8080/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Healthy${NC}"
    curl -s http://localhost:8080/health | jq '.'
else
    echo -e "${RED}✗ Unhealthy${NC}"
fi

echo ""

# Check Dashboard
echo -n "Dashboard (3000): "
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Healthy${NC}"
    curl -s http://localhost:3000/api/health | jq '.'
else
    echo -e "${RED}✗ Unhealthy${NC}"
fi

echo ""

# Check Redis
echo -n "Redis (6379): "
if docker exec arbitrage-redis redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Healthy${NC}"
else
    echo -e "${RED}✗ Unhealthy${NC}"
fi

echo ""

# Check containers
echo "=== Container Status ==="
docker-compose ps

echo ""

# Check recent signals
echo "=== Recent Signals ==="
if docker exec arbitrage-redis redis-cli --raw ZRANGE signals:history -5 -1 2>/dev/null; then
    echo -e "${GREEN}Retrieved last 5 signals${NC}"
else
    echo -e "${YELLOW}No signals yet${NC}"
fi
