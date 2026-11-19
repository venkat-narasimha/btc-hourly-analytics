"""
Shared test fixtures for the pipeline test suite.
All fixtures are synthetic — no network required.
"""

import hashlib
import io
import zipfile

import pandas as pd
import pytest

# --- Synthetic CSV data ---

# Timestamps: 2024-01-01 00:00:00 UTC = 1704067200000 ms
BASE_TS_MS = 1704067200000
HOUR_MS = 3_600_000

# Microsecond variant (GOTCHA 1): same timestamp * 1000
BASE_TS_US = BASE_TS_MS * 1000


def make_kline_row(
    open_time: int,
    o: float = 42000.0,
    h: float = 42100.0,
    low: float = 41900.0,
    c: float = 42050.0,
    vol: float = 100.0,
    qvol: float = 4200000.0,
    count: int = 500,
    tbvol: float = 60.0,
    tbqvol: float = 2520000.0,
) -> str:
    close_time = open_time + HOUR_MS - 1
    return f"{open_time},{o},{h},{low},{c},{vol},{close_time},{qvol},{count},{tbvol},{tbqvol},0"


def make_csv(rows: list[str], with_header: bool = False) -> str:
    """Build a CSV string from row strings, optionally with header."""
    lines = []
    if with_header:
        lines.append("open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore")
    lines.extend(rows)
    return "\n".join(lines) + "\n"


def make_zip(csv_text: str, filename: str = "BTCUSDT-1h-2024-01.csv") -> bytes:
    """Create a ZIP archive containing a single CSV file."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(filename, csv_text)
    return buf.getvalue()


def make_checksum(data: bytes, filename: str = "BTCUSDT-1h-2024-01.zip") -> str:
    """Create a Binance-style CHECKSUM string."""
    h = hashlib.sha256(data).hexdigest()
    return f"{h}  {filename}\n"


@pytest.fixture
def sample_csv_ms():
    """3 consecutive hourly bars with millisecond timestamps."""
    rows = [
        make_kline_row(BASE_TS_MS, 42000, 42100, 41900, 42050, 100, 4200000, 500, 60, 2520000),
        make_kline_row(BASE_TS_MS + HOUR_MS, 42050, 42200, 42000, 42150, 120, 5040000, 600, 70, 2940000),
        make_kline_row(BASE_TS_MS + 2 * HOUR_MS, 42150, 42300, 42050, 42100, 80, 3360000, 400, 40, 1680000),
    ]
    return make_csv(rows)


@pytest.fixture
def sample_csv_us():
    """3 bars with microsecond timestamps (GOTCHA 1)."""
    rows = [
        make_kline_row(BASE_TS_US, 42000, 42100, 41900, 42050, 100, 4200000, 500, 60, 2520000),
        make_kline_row(BASE_TS_US + HOUR_MS * 1000, 42050, 42200, 42000, 42150, 120, 5040000, 600, 70, 2940000),
        make_kline_row(BASE_TS_US + 2 * HOUR_MS * 1000, 42150, 42300, 42050, 42100, 80, 3360000, 400, 40, 1680000),
    ]
    return make_csv(rows)


@pytest.fixture
def sample_csv_with_header():
    """3 bars WITH header row (GOTCHA 2)."""
    rows = [
        make_kline_row(BASE_TS_MS, 42000, 42100, 41900, 42050, 100, 4200000, 500, 60, 2520000),
        make_kline_row(BASE_TS_MS + HOUR_MS, 42050, 42200, 42000, 42150, 120, 5040000, 600, 70, 2940000),
    ]
    return make_csv(rows, with_header=True)


@pytest.fixture
def sample_csv_with_dupes():
    """CSV with duplicate open_time rows (GOTCHA 3). Last should win."""
    rows = [
        make_kline_row(BASE_TS_MS, 42000, 42100, 41900, 42050, 100, 4200000, 500, 60, 2520000),
        make_kline_row(BASE_TS_MS, 42010, 42110, 41910, 42060, 110, 4300000, 510, 65, 2600000),  # dupe
        make_kline_row(BASE_TS_MS + HOUR_MS, 42050, 42200, 42000, 42150, 120, 5040000, 600, 70, 2940000),
    ]
    return make_csv(rows)


@pytest.fixture
def sample_csv_with_gap():
    """CSV with a 1-hour gap (hour 1 missing)."""
    rows = [
        make_kline_row(BASE_TS_MS, 42000, 42100, 41900, 42050, 100, 4200000, 500, 60, 2520000),
        # hour 1 missing
        make_kline_row(BASE_TS_MS + 2 * HOUR_MS, 42150, 42300, 42050, 42100, 80, 3360000, 400, 40, 1680000),
    ]
    return make_csv(rows)


@pytest.fixture
def sample_csv_zero_volume():
    """Bar with zero volume (valid — keep)."""
    rows = [
        make_kline_row(BASE_TS_MS, 42000, 42100, 41900, 42050, 0, 0, 0, 0, 0),
        make_kline_row(BASE_TS_MS + HOUR_MS, 42050, 42200, 42000, 42150, 120, 5040000, 600, 70, 2940000),
    ]
    return make_csv(rows)


@pytest.fixture
def sample_df():
    """Pre-parsed DataFrame with 5 consecutive hourly bars for transform tests."""
    data = []
    for i in range(5):
        data.append({
            "open_time": BASE_TS_MS + i * HOUR_MS,
            "open": 42000.0 + i * 50,
            "high": 42100.0 + i * 50,
            "low": 41900.0 + i * 50,
            "close": 42050.0 + i * 50,
            "volume": 100.0 + i * 10,
            "close_time": BASE_TS_MS + (i + 1) * HOUR_MS - 1,
            "quote_volume": 4200000.0 + i * 100000,
            "count": 500 + i * 10,
            "taker_buy_volume": 60.0 + i * 5,
            "taker_buy_quote_volume": 2520000.0 + i * 50000,
            "ignore": "0",
        })
    return pd.DataFrame(data)


@pytest.fixture
def invalid_rows_df():
    """DataFrame with various invalid rows for validation tests."""
    data = [
        # Valid row
        {
            "open_time_ms": BASE_TS_MS,
            "open": 42000.0, "high": 42100.0, "low": 41900.0, "close": 42050.0,
            "volume": 100.0, "quote_volume": 4200000.0, "trades": 500,
            "taker_buy_volume": 60.0, "taker_buy_quote_volume": 2520000.0,
            "log_ret": None, "hour": 0, "dow": 0,
            "taker_buy_ratio": 0.6, "hl_range": 0.00476,
        },
        # Invalid: negative price
        {
            "open_time_ms": BASE_TS_MS + HOUR_MS,
            "open": -1.0, "high": 42100.0, "low": 41900.0, "close": 42050.0,
            "volume": 100.0, "quote_volume": 4200000.0, "trades": 500,
            "taker_buy_volume": 60.0, "taker_buy_quote_volume": 2520000.0,
            "log_ret": 0.001, "hour": 1, "dow": 0,
            "taker_buy_ratio": 0.6, "hl_range": 0.00476,
        },
        # Invalid: high < low
        {
            "open_time_ms": BASE_TS_MS + 2 * HOUR_MS,
            "open": 42000.0, "high": 41800.0, "low": 42200.0, "close": 42050.0,
            "volume": 100.0, "quote_volume": 4200000.0, "trades": 500,
            "taker_buy_volume": 60.0, "taker_buy_quote_volume": 2520000.0,
            "log_ret": 0.001, "hour": 2, "dow": 0,
            "taker_buy_ratio": 0.6, "hl_range": -0.00952,
        },
        # Invalid: taker_buy_volume > volume
        {
            "open_time_ms": BASE_TS_MS + 3 * HOUR_MS,
            "open": 42000.0, "high": 42100.0, "low": 41900.0, "close": 42050.0,
            "volume": 50.0, "quote_volume": 4200000.0, "trades": 500,
            "taker_buy_volume": 100.0, "taker_buy_quote_volume": 2520000.0,
            "log_ret": 0.001, "hour": 3, "dow": 0,
            "taker_buy_ratio": 2.0, "hl_range": 0.00476,
        },
    ]
    return pd.DataFrame(data)
