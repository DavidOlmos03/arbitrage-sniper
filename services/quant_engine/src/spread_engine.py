"""Arbitrage opportunity detection engine.

This module calculates cross-exchange price spreads and identifies
profitable arbitrage opportunities when spread exceeds threshold.

Strategy: Buy at lowest ask, sell at highest bid across all exchanges.

Example:
    >>> engine = SpreadEngine(order_book, threshold_pct=0.5)
    >>> opportunity = engine.find_arbitrage('BTC/USDT')
    >>> if opportunity:
    ...     print(f"Spread: {opportunity['spread_pct']}%")
"""

from typing import Optional, Dict
from order_book import OrderBook, PriceLevel


class SpreadEngine:
    """Cross-exchange spread calculator and arbitrage detector.

    Analyzes price differences between exchanges and generates signals
    when profitable arbitrage opportunities are detected.

    Attributes:
        order_book (OrderBook): Order book instance for price data.
        threshold_pct (float): Minimum spread percentage for signal.
        signals_generated (int): Total signals generated counter.
    """

    def __init__(self, order_book: OrderBook, threshold_pct: float = 0.5):
        """Initialize spread engine.

        Args:
            order_book: OrderBook instance containing exchange prices.
            threshold_pct: Minimum spread percentage to generate signal.
                          Default is 0.5% (50 basis points).
        """
        self.order_book = order_book
        self.threshold_pct = threshold_pct
        self.signals_generated = 0

    def find_arbitrage(self, symbol: str) -> Optional[dict]:
        """Find best arbitrage opportunity for trading symbol.

        Compares all exchange pairs to find maximum spread opportunity.
        Only returns opportunities exceeding the configured threshold.

        Algorithm:
            1. Get all exchange prices for symbol
            2. Compare all exchange pairs (N×N comparisons)
            3. For each pair: spread = (sell_bid - buy_ask) / buy_ask
            4. Return best opportunity if spread > threshold

        Args:
            symbol: Trading pair symbol (e.g., 'BTC/USDT').

        Returns:
            dict: Arbitrage opportunity with keys:
                - buy_exchange (str): Exchange to buy from
                - sell_exchange (str): Exchange to sell on
                - buy_price (float): Price to buy at
                - sell_price (float): Price to sell at
                - spread_pct (float): Spread percentage
                - profit (float): Profit per unit
                - symbol (str): Trading pair
            None: If no opportunity exceeds threshold or < 2 exchanges.

        Example:
            >>> opp = engine.find_arbitrage('BTC/USDT')
            >>> if opp:
            ...     print(f"Buy {opp['buy_exchange']} @ ${opp['buy_price']}")
            ...     print(f"Sell {opp['sell_exchange']} @ ${opp['sell_price']}")
            ...     print(f"Spread: {opp['spread_pct']}%")
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
        """Get spread engine statistics.

        Returns:
            dict: Statistics containing:
                - threshold_pct (float): Configured spread threshold
                - signals_generated (int): Total signals generated
        """
        return {
            'threshold_pct': self.threshold_pct,
            'signals_generated': self.signals_generated
        }
