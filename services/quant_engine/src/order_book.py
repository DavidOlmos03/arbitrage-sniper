from dataclasses import dataclass
from typing import Dict, Optional
import time

@dataclass
class PriceLevel:
    """Simplified order book entry with bid/ask and timestamp"""
    __slots__ = ('bid', 'ask', 'timestamp')

    bid: float
    ask: float
    timestamp: int

class OrderBook:
    """In-memory order book maintaining latest prices per exchange"""

    def __init__(self, max_age_ms: int = 5000):
        # {exchange: {symbol: PriceLevel}}
        self._book: Dict[str, Dict[str, PriceLevel]] = {}
        self.max_age_ms = max_age_ms
        self.update_count = 0

    def update(self, exchange: str, symbol: str, price: float, timestamp: int) -> bool:
        """
        Update order book with new price.

        Simplified: creates synthetic bid/ask from trade price.
        Real implementation would use order book snapshots.

        Args:
            exchange: Exchange name (binance, coinbase)
            symbol: Trading pair (BTC/USDT)
            price: Trade price
            timestamp: Message timestamp

        Returns:
            True if updated, False if stale
        """
        if exchange not in self._book:
            self._book[exchange] = {}

        # Check if stale (older than current)
        current = self._book[exchange].get(symbol)
        if current and timestamp < current.timestamp:
            return False  # Ignore old data

        # Create synthetic bid/ask with small spread
        spread_buffer = price * 0.0001  # 0.01% spread

        self._book[exchange][symbol] = PriceLevel(
            bid=price - spread_buffer,
            ask=price + spread_buffer,
            timestamp=timestamp
        )

        self.update_count += 1
        return True

    def get(self, exchange: str, symbol: str) -> Optional[PriceLevel]:
        """Get price level for specific exchange and symbol"""
        return self._book.get(exchange, {}).get(symbol)

    def get_all_exchanges(self, symbol: str) -> Dict[str, PriceLevel]:
        """Get all exchanges that have this symbol"""
        result = {}
        for exchange, symbols in self._book.items():
            if symbol in symbols:
                # Filter out stale data
                if not self.is_stale(symbols[symbol].timestamp):
                    result[exchange] = symbols[symbol]
        return result

    def is_stale(self, timestamp: int) -> bool:
        """Check if timestamp is too old"""
        age_ms = (time.time() * 1000) - timestamp
        return age_ms > self.max_age_ms

    def get_stats(self):
        return {
            'exchanges': list(self._book.keys()),
            'symbols_count': len(self._book),
            'updates': self.update_count
        }
