#!/usr/bin/env python3
import asyncio
import uvloop
import signal
from config import config
from zmq_receiver import ZMQReceiver
from order_book import OrderBook
from spread_engine import SpreadEngine
from redis_publisher import SignalPublisher

# Install uvloop for 2-4x performance boost
asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())

class QuantEngine:
    """Main quant engine orchestrator"""

    def __init__(self):
        self.order_book = OrderBook(max_age_ms=config.MAX_PRICE_AGE_MS)
        self.spread_engine = SpreadEngine(
            self.order_book,
            threshold_pct=config.SPREAD_THRESHOLD_PCT
        )
        self.signal_publisher = SignalPublisher(
            config.REDIS_URL,
            channel=config.SIGNAL_CHANNEL
        )
        self.zmq_receiver = ZMQReceiver(config.ZMQ_ENDPOINT)
        self.running = True

    async def process_message(self, data: dict):
        """
        Process incoming market data message.

        Pipeline:
        1. Update order book
        2. Calculate spread
        3. Publish signal if threshold exceeded
        """
        try:
            import time

            # Measure processing latency
            receive_time = time.time() * 1000  # Current time in ms
            exchange_time = data.get('timestamp', receive_time)  # Exchange timestamp

            # Update order book
            updated = self.order_book.update(
                data['exchange'],
                data['symbol'],
                data['price'],
                data['timestamp']
            )

            if not updated:
                return  # Stale data, skip

            # Debug: Print prices and latency every 100 messages
            if self.zmq_receiver.message_count % 100 == 0:
                book = self.order_book.get_all_exchanges(data['symbol'])
                if len(book) >= 2:
                    prices = {ex: f"${level.bid:.2f}-${level.ask:.2f}" for ex, level in book.items()}

                    # Calculate latencies
                    total_latency = receive_time - exchange_time
                    processing_latency = (time.time() * 1000) - receive_time

                    print(f"[Debug] Prices: {prices}")
                    print(f"[Latency] Exchange→Quant: {total_latency:.2f}ms | Processing: {processing_latency:.2f}ms")

            # Check for arbitrage opportunity
            spread_start = time.time() * 1000
            opportunity = self.spread_engine.find_arbitrage(data['symbol'])
            spread_latency = (time.time() * 1000) - spread_start

            if opportunity:
                signal_start = time.time() * 1000
                await self.signal_publisher.publish_signal(opportunity)
                signal_latency = (time.time() * 1000) - signal_start

                # Calculate end-to-end latency
                e2e_latency = (time.time() * 1000) - exchange_time
                internal_latency = (time.time() * 1000) - receive_time

                print(f"[Latency] Spread: {spread_latency:.2f}ms | Redis: {signal_latency:.2f}ms | Internal: {internal_latency:.2f}ms | E2E: {e2e_latency:.2f}ms")

        except Exception as e:
            print(f"[Engine] Process error: {e}")

    async def start(self):
        """Start the quant engine"""
        print("=== Arbitrage Sniper - Quant Engine ===")
        print(f"Spread Threshold: {config.SPREAD_THRESHOLD_PCT}%")
        print(f"Symbols: {config.SYMBOLS}\n")

        # Connect to Redis
        redis_ok = await self.signal_publisher.connect()
        if not redis_ok:
            print("[Engine] Redis connection failed. Exiting.")
            return

        # Connect to ZMQ
        await self.zmq_receiver.connect()

        # Start receiving messages
        print("[Engine] Processing market data...\n")
        await self.zmq_receiver.receive_loop(self.process_message)

    async def stop(self):
        """Graceful shutdown"""
        print("\n[Engine] Shutting down...")
        self.running = False

        # Print stats
        print("\n=== Statistics ===")
        print("Order Book:", self.order_book.get_stats())
        print("Spread Engine:", self.spread_engine.get_stats())
        print("Signal Publisher:", self.signal_publisher.get_stats())
        print("ZMQ Receiver:", self.zmq_receiver.get_stats())

        self.zmq_receiver.close()
        await self.signal_publisher.close()
        print("[Engine] Shutdown complete")

async def main():
    """Main entry point"""
    engine = QuantEngine()

    try:
        await engine.start()
    except KeyboardInterrupt:
        print("\n[Engine] Interrupted by user")
        await engine.stop()
    except Exception as e:
        print(f"\n[Engine] Error: {e}")
        await engine.stop()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Engine] Shutting down...")
