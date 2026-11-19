"""
Ingest module: download, verify, and parse Binance kline data.

Handles monthly + daily ZIP files, checksum verification, caching,
and CSV parsing with PLAN.md §3 gotcha handling.
"""

import hashlib
import io
import logging
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
import pandas as pd

from .config import (
    BACKOFF_BASE_S,
    BASE_URL,
    CSV_COLUMNS,
    DOWNLOAD_TIMEOUT_S,
    INTERVAL,
    MAX_RETRIES,
    START_MONTH,
    START_YEAR,
    SYMBOL,
    USER_AGENT,
)

logger = logging.getLogger(__name__)


def enumerate_months(now_utc: Optional[datetime] = None) -> list[tuple[int, int]]:
    """Return list of (year, month) from START to last completed month (UTC)."""
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    months = []
    y, m = START_YEAR, START_MONTH
    while (y, m) < (now_utc.year, now_utc.month):
        months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return months


def enumerate_current_month_days(now_utc: Optional[datetime] = None) -> list[str]:
    """Return list of 'YYYY-MM-DD' for days 1..yesterday in current UTC month."""
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    days = []
    for d in range(1, now_utc.day):  # up to yesterday
        days.append(f"{now_utc.year}-{now_utc.month:02d}-{d:02d}")
    return days


def enumerate_month_days(year: int, month: int) -> list[str]:
    """Return list of 'YYYY-MM-DD' for all possible days (1-31) in a month."""
    days = []
    for d in range(1, 32):
        days.append(f"{year}-{month:02d}-{d:02d}")
    return days


def monthly_url(year: int, month: int) -> str:
    return f"{BASE_URL}/monthly/klines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{year}-{month:02d}.zip"


def monthly_checksum_url(year: int, month: int) -> str:
    return f"{monthly_url(year, month)}.CHECKSUM"


def daily_url(date_str: str) -> str:
    return f"{BASE_URL}/daily/klines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{date_str}.zip"


def daily_checksum_url(date_str: str) -> str:
    return f"{daily_url(date_str)}.CHECKSUM"


def cache_path(cache_dir: Path, url: str) -> Path:
    """Deterministic cache path for a URL."""
    # Use URL hash to avoid filesystem issues with long paths
    url_hash = hashlib.md5(url.encode()).hexdigest()
    filename = url.split("/")[-1]
    return cache_dir / f"{url_hash}_{filename}"


def parse_checksum(checksum_text: str) -> str:
    """Parse Binance CHECKSUM file format: '<hex>  <filename>'."""
    parts = checksum_text.strip().split()
    if len(parts) >= 1:
        return parts[0].lower()
    raise ValueError(f"Cannot parse checksum: {checksum_text!r}")


def verify_checksum(data: bytes, expected_hex: str) -> bool:
    """Verify SHA-256 checksum of data."""
    actual = hashlib.sha256(data).hexdigest().lower()
    return actual == expected_hex.lower()


def download_with_retry(
    client: httpx.Client, url: str, max_retries: int = MAX_RETRIES
) -> Optional[bytes]:
    """Download a URL with exponential backoff. Returns None on 404."""
    for attempt in range(max_retries):
        try:
            resp = client.get(url, timeout=DOWNLOAD_TIMEOUT_S)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.content
        except (httpx.HTTPStatusError, httpx.TransportError) as e:
            if attempt < max_retries - 1:
                wait = BACKOFF_BASE_S * (2**attempt)
                logger.warning(f"Retry {attempt+1}/{max_retries} for {url}: {e}. Waiting {wait}s")
                time.sleep(wait)
            else:
                raise
    return None  # unreachable


def download_and_verify(
    client: httpx.Client,
    zip_url: str,
    checksum_url: str,
    cache_dir: Path,
    force_refetch: bool = False,
    stats: Optional[dict] = None,
) -> Optional[bytes]:
    """
    Download a ZIP + its CHECKSUM, verify, cache.
    Returns ZIP bytes or None if 404.
    Raises on checksum mismatch after retry.
    """
    cached = cache_path(cache_dir, zip_url)

    # Try checksum first
    checksum_data = download_with_retry(client, checksum_url)
    if checksum_data is None:
        # No checksum → no file
        return None

    expected_hash = parse_checksum(checksum_data.decode("utf-8"))

    # Check cache
    if not force_refetch and cached.exists():
        cached_bytes = cached.read_bytes()
        if verify_checksum(cached_bytes, expected_hash):
            logger.debug(f"Cache hit: {zip_url}")
            return cached_bytes
        else:
            logger.warning(f"Cache checksum mismatch, re-downloading: {zip_url}")

    # Download ZIP
    zip_data = download_with_retry(client, zip_url)
    if zip_data is None:
        return None

    # Verify
    if not verify_checksum(zip_data, expected_hash):
        # Retry once
        logger.warning(f"Checksum mismatch, retrying: {zip_url}")
        zip_data = download_with_retry(client, zip_url)
        if zip_data is None or not verify_checksum(zip_data, expected_hash):
            if stats is not None:
                stats["checksum_failures"] = stats.get("checksum_failures", 0) + 1
            raise ValueError(f"Checksum verification failed after retry: {zip_url}")

    if stats is not None:
        stats["checksums_verified"] = stats.get("checksums_verified", 0) + 1

    # Cache
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(zip_data)

    return zip_data


def extract_csv_from_zip(zip_data: bytes) -> str:
    """Extract the single CSV file from a ZIP archive."""
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        names = zf.namelist()
        csv_names = [n for n in names if n.endswith(".csv")]
        if not csv_names:
            raise ValueError(f"No CSV found in ZIP, files: {names}")
        return zf.read(csv_names[0]).decode("utf-8")


def has_header(csv_text: str) -> bool:
    """GOTCHA 2: Detect if CSV has a header row (first field is non-numeric)."""
    first_line = csv_text.strip().split("\n")[0]
    first_field = first_line.split(",")[0].strip()
    try:
        float(first_field)
        return False
    except ValueError:
        return True


def normalize_timestamp(ts: int) -> int:
    """
    GOTCHA 1: Normalize timestamp to milliseconds.
    > 1e14 → microseconds, divide by 1000.
    """
    if ts > 1e14:
        return ts // 1000
    return ts


def parse_csv(csv_text: str, stats: Optional[dict] = None) -> pd.DataFrame:
    """
    Parse a Binance klines CSV into a DataFrame.
    Handles headers, timestamp normalization per PLAN.md §3 gotchas.
    """
    header_present = has_header(csv_text)
    if stats is not None:
        if header_present:
            stats["header_files"] = stats.get("header_files", 0) + 1

    skiprows = 1 if header_present else 0

    df = pd.read_csv(
        io.StringIO(csv_text),
        header=None,
        skiprows=skiprows,
        names=CSV_COLUMNS,
        dtype={
            "open_time": "int64",
            "open": "float64",
            "high": "float64",
            "low": "float64",
            "close": "float64",
            "volume": "float64",
            "close_time": "int64",
            "quote_volume": "float64",
            "count": "int32",
            "taker_buy_volume": "float64",
            "taker_buy_quote_volume": "float64",
            "ignore": "str",
        },
    )

    # Track ms vs µs files
    if len(df) > 0:
        sample_ts = df["open_time"].iloc[0]
        if sample_ts > 1e14:
            if stats is not None:
                stats["files_us"] = stats.get("files_us", 0) + 1
        else:
            if stats is not None:
                stats["files_ms"] = stats.get("files_ms", 0) + 1

    # Normalize timestamps per-value
    df["open_time"] = df["open_time"].apply(normalize_timestamp)
    df["close_time"] = df["close_time"].apply(normalize_timestamp)

    return df


def ingest(
    out_dir: Path,
    now_utc: Optional[datetime] = None,
) -> tuple[pd.DataFrame, dict]:
    """
    Full ingestion: download all monthly + daily files, parse, return combined DataFrame.
    Returns (dataframe, stats_dict).
    """
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)

    cache_dir = out_dir / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    stats: dict = {
        "checksums_verified": 0,
        "checksum_failures": 0,
        "files_ms": 0,
        "files_us": 0,
        "header_files": 0,
        "monthly_files": 0,
        "daily_files": 0,
    }

    all_dfs: list[pd.DataFrame] = []

    client = httpx.Client(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=DOWNLOAD_TIMEOUT_S,
    )

    try:
        # 1. Monthly files
        months = enumerate_months(now_utc)
        for year, month in months:
            logger.info(f"Fetching monthly: {year}-{month:02d}")
            try:
                zip_data = download_and_verify(
                    client,
                    monthly_url(year, month),
                    monthly_checksum_url(year, month),
                    cache_dir,
                    stats=stats,
                )
            except ValueError as e:
                logger.error(f"Checksum failure for monthly {year}-{month:02d}: {e}")
                raise

            if zip_data is not None:
                csv_text = extract_csv_from_zip(zip_data)
                df = parse_csv(csv_text, stats)
                all_dfs.append(df)
                stats["monthly_files"] += 1
                logger.info(f"  Monthly {year}-{month:02d}: {len(df)} rows")
            else:
                # Fallback to daily files for this month
                logger.info(f"  Monthly {year}-{month:02d} not found, falling back to daily")
                days = enumerate_month_days(year, month)
                for day_str in days:
                    try:
                        zip_data = download_and_verify(
                            client,
                            daily_url(day_str),
                            daily_checksum_url(day_str),
                            cache_dir,
                            stats=stats,
                        )
                    except ValueError as e:
                        logger.error(f"Checksum failure for daily {day_str}: {e}")
                        raise

                    if zip_data is not None:
                        csv_text = extract_csv_from_zip(zip_data)
                        df = parse_csv(csv_text, stats)
                        all_dfs.append(df)
                        stats["daily_files"] += 1

        # 2. Current month daily files (days 1 → yesterday)
        current_days = enumerate_current_month_days(now_utc)
        # Determine which daily files to force-refetch (last 3)
        force_refetch_days = set(current_days[-3:]) if len(current_days) >= 3 else set(current_days)

        for day_str in current_days:
            logger.info(f"Fetching daily: {day_str}")
            force = day_str in force_refetch_days
            try:
                zip_data = download_and_verify(
                    client,
                    daily_url(day_str),
                    daily_checksum_url(day_str),
                    cache_dir,
                    force_refetch=force,
                    stats=stats,
                )
            except ValueError as e:
                logger.error(f"Checksum failure for daily {day_str}: {e}")
                raise

            if zip_data is not None:
                csv_text = extract_csv_from_zip(zip_data)
                df = parse_csv(csv_text, stats)
                all_dfs.append(df)
                stats["daily_files"] += 1

    finally:
        client.close()

    if not all_dfs:
        raise RuntimeError("No data files were downloaded — zero rows ingested")

    combined = pd.concat(all_dfs, ignore_index=True)
    logger.info(f"Ingestion complete: {len(combined)} raw rows from {stats['monthly_files']} monthly + {stats['daily_files']} daily files")

    return combined, stats
