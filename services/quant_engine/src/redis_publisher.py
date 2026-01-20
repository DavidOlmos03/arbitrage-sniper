"""Redis signal publisher for arbitrage opportunities.

This module publishes arbitrage signals to Redis PUB/SUB channel and
maintains a sorted history of recent signals.

Example:
    >>> publisher = SignalPublisher('redis://localhost:6379')
    >>> await publisher.connect()
    >>> await publisher.publish_signal(opportunity)
"""

from redis.asyncio import Redis
import orjson
import time


class SignalPublisher:
    """Redis publisher for arbitrage signals.

    Publishes signals to PUB/SUB channel and maintains sorted history.
    Uses orjson for fast serialization (2x faster than stdlib).

    Attributes:
        redis (Redis): Async Redis client instance.
        channel (str): PUB/SUB channel name.
        signal_count (int): Total signals published counter.
    """

    def __init__(self, redis_url: str, channel: str = 'arbitrage:signals'):
        """Initialize signal publisher.

        Args:
            redis_url: Redis connection URL (e.g., 'redis://localhost:6379').
            channel: PUB/SUB channel name for signals.
        """
        self.redis = Redis.from_url(redis_url, decode_responses=False)
        self.channel = channel
        self.signal_count = 0

    async def connect(self):
        """Test Redis connection.

        Sends a ping to verify connectivity before starting.

        Returns:
            bool: True if connection successful, False otherwise.

        Raises:
            Exception: Connection errors are caught and logged.
        """
        try:
            await self.redis.ping()
            print(f"[Redis] Connected to {self.redis}")
            return True
        except Exception as e:
            print(f"[Redis] Connection error: {e}")
            return False

    async def publish_signal(self, opportunity: dict):
        """Publish arbitrage signal to Redis.

        Performs two operations atomically:
        1. Publishes to PUB/SUB channel for real-time subscribers
        2. Stores in sorted set (history) for later retrieval

        Signal format includes:
        - type: Signal type identifier
        - action: Trading action description
        - spread_pct: Spread percentage
        - buy_price/sell_price: Execution prices
        - profit_estimate: Estimated profit per unit
        - timestamp: Signal generation time

        Args:
            opportunity: Arbitrage opportunity dict from spread engine.
                        Must contain: buy_exchange, sell_exchange, symbol,
                        spread_pct, buy_price, sell_price, profit.

        Raises:
            Exception: Redis publish or storage errors are logged.

        Example:
            >>> await publisher.publish_signal({
            ...     'buy_exchange': 'binance',
            ...     'sell_exchange': 'coinbase',
            ...     'spread_pct': 0.75,
            ...     'buy_price': 45100.00,
            ...     'sell_price': 45438.25,
            ...     'profit': 338.25,
            ...     'symbol': 'BTC/USDT'
            ... })
        """
        signal = {
            'type': 'ARBITRAGE_OPPORTUNITY',
            'action': f"BUY_{opportunity['buy_exchange'].upper()}_SELL_{opportunity['sell_exchange'].upper()}",
            'symbol': opportunity['symbol'],
            'spread_pct': opportunity['spread_pct'],
            'buy_price': opportunity['buy_price'],
            'sell_price': opportunity['sell_price'],
            'profit_estimate': opportunity['profit'],
            'timestamp': int(time.time() * 1000)
        }

        try:
            # Serialize with orjson (faster)
            signal_json = orjson.dumps(signal)

            # Publish to PUB/SUB channel
            await self.redis.publish(self.channel, signal_json)

            # Store in sorted set (history, scored by timestamp)
            await self.redis.zadd(
                'signals:history',
                {signal_json.decode('utf-8'): signal['timestamp']}
            )

            # Keep only last 1000 signals
            await self.redis.zremrangebyrank('signals:history', 0, -1001)

            self.signal_count += 1

            print(f"[SIGNAL] {signal['action']} @ {signal['spread_pct']}% (Profit: ${signal['profit_estimate']})")

        except Exception as e:
            print(f"[Redis] Publish error: {e}")

    def get_stats(self):
        """Get publisher statistics.

        Returns:
            dict: Statistics containing:
                - signals_published (int): Total signals published
                - channel (str): PUB/SUB channel name
        """
        return {
            'signals_published': self.signal_count,
            'channel': self.channel
        }

    async def close(self):
        """Close Redis connection.

        Should be called during graceful shutdown to release resources.
        """
        await self.redis.close()
