.PHONY: help build up down restart logs health clean

help:
	@echo "Arbitrage Sniper - Makefile Commands"
	@echo ""
	@echo "  make build    - Build all Docker images"
	@echo "  make up       - Start all services"
	@echo "  make down     - Stop all services"
	@echo "  make restart  - Restart all services"
	@echo "  make logs     - View logs (all services)"
	@echo "  make health   - Run health check"
	@echo "  make clean    - Remove all containers and images"
	@echo ""

build:
	docker-compose build

up:
	docker-compose up -d
	@echo ""
	@echo "✓ All services started"
	@echo ""
	@echo "Dashboard: http://localhost:3001"
	@echo "Ingestor Health: http://localhost:8080/health"
	@echo "Dashboard Health: http://localhost:3001/api/health"
	@echo ""
	@echo "Run 'make logs' to view logs"
	@echo "Run 'make health' to check service health"

down:
	docker-compose down

restart:
	docker-compose restart

logs:
	docker-compose logs -f

health:
	@bash health-check.sh

clean:
	docker-compose down -v --rmi all
	@echo "✓ All containers, volumes, and images removed"
