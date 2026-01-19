from redis.asyncio import Redis
import orjson
import time

class SignalPublisher:
    """Publishes arbitrage signals to Redis PUB/SUB"""

    def __init__(self, redis_url: str, channel: str = 'arbitrage:signals'):
        self.redis = Redis.from_url(redis_url, decode_responses=False)
        self.channel = channel
        self.signal_count = 0

    async def connect(self):
        """Test Redis connection"""
        try:
            await self.redis.ping()
            print(f"[Redis] Connected to {self.redis}")
            return True
        except Exception as e:
            print(f"[Redis] Connection error: {e}")
            return False

    async def publish_signal(self, opportunity: dict):
        """
        Publish arbitrage signal to Redis PUB/SUB and store in history.

        Args:
            opportunity: Arbitrage opportunity from spread engine
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
        return {
            'signals_published': self.signal_count,
            'channel': self.channel
        }

    async def close(self):
        await self.redis.close()
