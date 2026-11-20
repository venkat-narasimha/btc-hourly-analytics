"""Pipeline configuration constants."""

SYMBOL = "BTCUSDT"
MARKET = "um-futures"
INTERVAL = "1h"

BASE_URL = "https://data.binance.vision/data/futures/um"

# CSV columns from Binance UM futures klines
CSV_COLUMNS = [
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_volume",
    "count",
    "taker_buy_volume",
    "taker_buy_quote_volume",
    "ignore",
]

# Output parquet column order
PARQUET_COLUMNS = [
    "open_time_ms",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "quote_volume",
    "trades",
    "taker_buy_volume",
    "taker_buy_quote_volume",
    "log_ret",
    "hour",
    "dow",
    "taker_buy_ratio",
    "hl_range",
]

# One hour in milliseconds
HOUR_MS = 3_600_000

# User-Agent for HTTP requests
USER_AGENT = "btc-hourly-analytics-etl/1.0 (github.com/venkat-narasimha/btc-hourly-analytics; educational)"

# Download timeouts and retries
DOWNLOAD_TIMEOUT_S = 60
MAX_RETRIES = 3
BACKOFF_BASE_S = 2.0

# Release management
MAX_RELEASES = 3

# Start date for data collection
START_YEAR = 2020
START_MONTH = 1
