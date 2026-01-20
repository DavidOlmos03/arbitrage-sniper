"""Configuration module for the Arbitrage Sniper Quant Engine.

This module provides centralized configuration management for the quant engine
service. It loads settings from environment variables using python-dotenv and
exposes them through a singleton Config class instance.

The configuration supports runtime customization through environment variables
while providing sensible defaults for development environments. All settings
are loaded at module import time for optimal performance.

Module Attributes:
    config (Config): Singleton configuration instance for application-wide use.

Environment Variables:
    ZMQ_ENDPOINT: ZeroMQ endpoint address (default: tcp://ingestor:5555)
    REDIS_URL: Redis server URL (default: redis://redis:6379)
    SPREAD_THRESHOLD_PCT: Minimum arbitrage spread % (default: 0.5)
    SYMBOLS: Comma-separated trading pairs (default: BTC/USDT)
    LOG_LEVEL: Logging verbosity level (default: info)

Examples:
    >>> from config import config
    >>> print(config.SPREAD_THRESHOLD_PCT)
    0.5
    >>> print(config.SYMBOLS)
    ['BTC/USDT']

Notes:
    - All environment variables are loaded from .env file if present
    - Configuration is immutable after module import
    - Type conversion is performed automatically for numeric values
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Config:
    """Application configuration class.

    Centralized configuration container that loads settings from environment
    variables with type-safe defaults. This class uses class attributes for
    zero-overhead access patterns common in high-frequency trading systems.

    All configuration values are loaded at class definition time and remain
    constant throughout the application lifecycle. This design ensures
    predictable behavior and eliminates configuration-related race conditions.

    Attributes:
        ZMQ_ENDPOINT (str): ZeroMQ PULL socket endpoint address for receiving
            market data from the Node.js ingestor service.
            Default: 'tcp://ingestor:5555'

        REDIS_URL (str): Redis server connection URL for publishing arbitrage
            signals and maintaining signal history.
            Default: 'redis://redis:6379'

        SPREAD_THRESHOLD_PCT (float): Minimum spread percentage required to
            generate an arbitrage signal. Opportunities below this threshold
            are ignored to filter noise and account for transaction costs.
            Default: 0.5 (50 basis points)

        SYMBOLS (list[str]): List of trading pair symbols to monitor for
            arbitrage opportunities. Multiple symbols can be specified as
            comma-separated values in the environment variable.
            Default: ['BTC/USDT']

        LOG_LEVEL (str): Logging verbosity level. Valid values are 'debug',
            'info', 'warn', 'error'. Controls console output detail.
            Default: 'info'

        SIGNAL_CHANNEL (str): Redis PUB/SUB channel name for publishing
            arbitrage signals. Subscribers listen on this channel for
            real-time opportunity notifications.
            Default: 'arbitrage:signals'

        MAX_PRICE_AGE_MS (int): Maximum age in milliseconds before a price
            quote is considered stale and excluded from arbitrage calculations.
            Prevents using outdated data that could lead to false signals.
            Default: 5000 (5 seconds)

    Examples:
        >>> config = Config()
        >>> config.SPREAD_THRESHOLD_PCT
        0.5
        >>> config.SYMBOLS
        ['BTC/USDT']
    """

    # Network endpoints
    ZMQ_ENDPOINT = os.getenv('ZMQ_ENDPOINT', 'tcp://ingestor:5555')
    REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379')

    # Trading parameters
    SPREAD_THRESHOLD_PCT = float(os.getenv('SPREAD_THRESHOLD_PCT', '0.5'))
    SYMBOLS = os.getenv('SYMBOLS', 'BTC/USDT').split(',')

    # System settings
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'info')
    SIGNAL_CHANNEL = 'arbitrage:signals'
    MAX_PRICE_AGE_MS = 5000  # 5 seconds maximum price age


# Singleton configuration instance
config = Config()
