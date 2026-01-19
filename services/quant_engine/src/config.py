import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    ZMQ_ENDPOINT = os.getenv('ZMQ_ENDPOINT', 'tcp://ingestor:5555')
    REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379')
    SPREAD_THRESHOLD_PCT = float(os.getenv('SPREAD_THRESHOLD_PCT', '0.5'))
    SYMBOLS = os.getenv('SYMBOLS', 'BTC/USDT').split(',')
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'info')
    SIGNAL_CHANNEL = 'arbitrage:signals'
    MAX_PRICE_AGE_MS = 5000  # 5 seconds

config = Config()
