from typing import Optional, Dict
from order_book import OrderBook, PriceLevel

class SpreadEngine:
    """Calculates cross-exchange spreads and detects arbitrage opportunities"""

    def __init__(self, order_book: OrderBook, threshold_pct: float = 0.5):
        self.order_book = order_book
        self.threshold_pct = threshold_pct
        self.signals_generated = 0

    def find_arbitrage(self, symbol: str) -> Optional[dict]:
        """
        Find best arbitrage opportunity for symbol.

        Strategy: Buy at lowest ask, sell at highest bid across exchanges.

        Args:
            symbol: Trading pair (BTC/USDT)

        Returns:
            Arbitrage opportunity dict or None
        """
        exchanges = self.order_book.get_all_exchanges(symbol)

        if len(exchanges) < 2:
            return None  # Need at least 2 exchanges

        best_opportunity = None
        max_spread = 0.0

        # Compare all exchange pairs
        exchange_names = list(exchanges.keys())

        for buy_ex in exchange_names:
            for sell_ex in exchange_names:
                if buy_ex == sell_ex:
                    continue

                buy_book = exchanges[buy_ex]
                sell_book = exchanges[sell_ex]

                # Calculate spread: buy at ask, sell at bid
                buy_price = buy_book.ask
                sell_price = sell_book.bid

                profit = sell_price - buy_price
                spread_pct = (profit / buy_price) * 100

                if spread_pct > max_spread:
                    max_spread = spread_pct
                    best_opportunity = {
                        'buy_exchange': buy_ex,
                        'sell_exchange': sell_ex,
                        'buy_price': round(buy_price, 2),
                        'sell_price': round(sell_price, 2),
                        'spread_pct': round(spread_pct, 4),
                        'profit': round(profit, 2),
                        'symbol': symbol
                    }

        # Return only if exceeds threshold
        if best_opportunity and best_opportunity['spread_pct'] > self.threshold_pct:
            self.signals_generated += 1
            return best_opportunity

        return None

    def get_stats(self):
        return {
            'threshold_pct': self.threshold_pct,
            'signals_generated': self.signals_generated
        }
