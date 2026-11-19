"""
Transform module: deduplicate, sort, validate, compute features.

Operates on the raw ingested DataFrame and produces a clean, feature-enriched
DataFrame matching the §5 data contract.
"""

import logging

import numpy as np
import pandas as pd

from .config import HOUR_MS

logger = logging.getLogger(__name__)


def dedupe_and_sort(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """
    GOTCHA 3: Sort by open_time, deduplicate by open_time (keep last).
    Returns (cleaned_df, duplicates_removed_count).
    """
    before = len(df)
    df = df.sort_values("open_time", ascending=True)
    df = df.drop_duplicates(subset=["open_time"], keep="last")
    df = df.reset_index(drop=True)
    dupes = before - len(df)
    if dupes:
        logger.info(f"Removed {dupes} duplicate rows")
    return df, dupes


def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute derived columns per §5 data contract:
    - open_time_ms (rename)
    - log_ret: ln(close_t / close_{t-1}), null if prev bar not exactly 1h before
    - hour: 0-23 UTC
    - dow: 0=Mon..6=Sun UTC
    - taker_buy_ratio: taker_buy_volume / volume, null if volume == 0
    - hl_range: (high - low) / open
    """
    df = df.copy()

    # Rename open_time → open_time_ms
    df = df.rename(columns={"open_time": "open_time_ms", "count": "trades"})

    # log_ret: null for first row or if prev bar not exactly HOUR_MS earlier
    df["log_ret"] = np.nan
    if len(df) > 1:
        time_diff = df["open_time_ms"].diff()
        prev_close = df["close"].shift(1)
        # Only compute where previous bar is exactly 1 hour before and both closes > 0
        valid_mask = (time_diff == HOUR_MS) & (prev_close > 0) & (df["close"] > 0)
        df.loc[valid_mask, "log_ret"] = np.log(
            df.loc[valid_mask, "close"] / prev_close[valid_mask]
        )

    # hour: 0-23 UTC from open_time_ms
    df["hour"] = ((df["open_time_ms"] // HOUR_MS) % 24).astype("int8")

    # dow: 0=Mon..6=Sun
    # Unix epoch (1970-01-01) was a Thursday = 3
    # days_since_epoch = open_time_ms // (HOUR_MS * 24)
    # dow = (days_since_epoch + 3) % 7  → 0=Mon
    df["dow"] = (((df["open_time_ms"] // (HOUR_MS * 24)) + 3) % 7).astype("int8")

    # taker_buy_ratio: null if volume == 0
    df["taker_buy_ratio"] = np.where(
        df["volume"] == 0, np.nan, df["taker_buy_volume"] / df["volume"]
    )

    # hl_range: (high - low) / open
    df["hl_range"] = (df["high"] - df["low"]) / df["open"]

    return df


def select_output_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Select and order columns per data contract §5."""
    from .config import PARQUET_COLUMNS

    return df[PARQUET_COLUMNS].copy()
