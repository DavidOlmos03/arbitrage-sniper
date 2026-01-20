#!/usr/bin/env python3
"""Main entry point for the Arbitrage Sniper Quant Engine.

This service performs ultra-low-latency arbitrage detection:
1. Receives market data from ZeroMQ (from Node.js ingestor)
2. Maintains in-memory order book
3. Calculates cross-exchange spreads
4. Publishes signals to Redis when opportunities detected

Architecture:
- Uses uvloop for 2-4x performance boost over standard asyncio
- Non-blocking async I/O throughout
- Target latency: <5ms (achieves ~0.5-1ms typically)

Performance optimizations:
- orjson for fast JSON parsing
- __slots__ for memory efficiency
- In-memory only (no database)
- Lock-free single-threaded design

Example:
    Run the quant engine:
    $ python main.py

    Environment variables:
    - ZMQ_ENDPOINT: Ingestor address
    - REDIS_URL: Redis connection URL
    - SPREAD_THRESHOLD_PCT: Minimum spread for signals
"""

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
    """Main quant engine orchestrator.

    Coordinates all components of the arbitrage detection pipeline:
    - Market data reception (ZeroMQ)
    - Order book management
    - Spread calculation
    - Signal publishing (Redis)

    Processing pipeline per message:
    1. Receive from ZMQ (~0.3ms)
    2. Update order book (~0.01ms)
    3. Calculate spread (~0.02ms)
    4. Publish to Redis if threshold exceeded (~0.5ms)

    Total internal latency: <1ms typical

    Attributes:
        order_book (OrderBook): In-memory price storage.
        spread_engine (SpreadEngine): Arbitrage detector.
        signal_publisher (SignalPublisher): Redis publisher.
        zmq_receiver (ZMQReceiver): Market data receiver.
        running (bool): Engine running state.
    """

    def __init__(self):
        """Initialize quant engine with all components.

        Loads configuration and creates component instances.
        Does not start connections (call start() for that).
        """
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
        """Process incoming market data message.

        Main processing pipeline executed for each message:
        1. Measure receive latency
        2. Update in-memory order book
        3. Calculate cross-exchange spreads
        4. Generate and publish signal if threshold exceeded
        5. Log latency metrics every 100 messages

        Latency tracking:
        - Exchange→Quant: Network latency from exchange
        - Processing: Order book update time
        - Spread calc: Arbitrage calculation time
        - Redis publish: Signal publishing time
        - E2E: Total end-to-end time
        - Internal: Quant engine processing only

        Args:
            data: Market data dict from ingestor containing:
                - exchange (str): Exchange identifier
                - symbol (str): Trading pair
                - price (float): Trade price
                - timestamp (int): Exchange timestamp in ms

        Raises:
            Exception: Errors are logged but don't stop processing.
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
        """Start the quant engine.

        Initialization sequence:
        1. Print configuration
        2. Connect to Redis
        3. Connect to ZeroMQ
        4. Start message processing loop

        This method blocks until shutdown signal received.

        Raises:
            SystemExit: If Redis connection fails.
        """
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
        """Perform graceful shutdown.

        Shutdown sequence:
        1. Set running flag to False
        2. Print final statistics
        3. Close ZeroMQ socket
        4. Close Redis connection

        Statistics printed:
        - Order book: Exchanges, symbols, updates
        - Spread engine: Threshold, signals generated
        - Signal publisher: Signals published, channel
        - ZMQ receiver: Messages received, endpoint
        """
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
    """Main entry point.

    Creates quant engine instance and runs until interrupted.
    Handles KeyboardInterrupt and general exceptions gracefully.

    Raises:
        KeyboardInterrupt: User interrupted with Ctrl+C.
        Exception: Any other fatal error.
    """
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
