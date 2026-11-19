"""
Validate module: enforce data quality rules per §6.

Returns quarantined rows and a quality report dict.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd

from .config import HOUR_MS

logger = logging.getLogger(__name__)

# Small epsilon for float comparisons
EPSILON = 1e-8


def validate_rows(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, list[dict]]:
    """
    Validate individual rows per §6 rules:
    - high >= max(open, close)
    - low <= min(open, close)
    - high >= low
    - prices (open/high/low/close) > 0
    - volume >= 0
    - taker_buy_volume <= volume (+ tiny epsilon)

    Returns (valid_df, quarantined_df, quarantine_reasons).
    Zero-volume bars are valid — keep.
    """
    quarantine_reasons: list[dict] = []
    invalid_mask = pd.Series(False, index=df.index)

    # Prices > 0
    price_cols = ["open", "high", "low", "close"]
    for col in price_cols:
        bad = df[col] <= 0
        if bad.any():
            count = bad.sum()
            quarantine_reasons.append({"reason": f"{col} <= 0", "count": int(count)})
            invalid_mask |= bad

    # high >= max(open, close)
    bad = df["high"] < np.maximum(df["open"], df["close"]) - EPSILON
    if bad.any():
        quarantine_reasons.append({"reason": "high < max(open, close)", "count": int(bad.sum())})
        invalid_mask |= bad

    # low <= min(open, close)
    bad = df["low"] > np.minimum(df["open"], df["close"]) + EPSILON
    if bad.any():
        quarantine_reasons.append({"reason": "low > min(open, close)", "count": int(bad.sum())})
        invalid_mask |= bad

    # high >= low
    bad = df["high"] < df["low"] - EPSILON
    if bad.any():
        quarantine_reasons.append({"reason": "high < low", "count": int(bad.sum())})
        invalid_mask |= bad

    # volume >= 0
    bad = df["volume"] < 0
    if bad.any():
        quarantine_reasons.append({"reason": "volume < 0", "count": int(bad.sum())})
        invalid_mask |= bad

    # taker_buy_volume <= volume + epsilon
    bad = df["taker_buy_volume"] > df["volume"] + EPSILON
    if bad.any():
        quarantine_reasons.append({"reason": "taker_buy_volume > volume", "count": int(bad.sum())})
        invalid_mask |= bad

    valid_df = df[~invalid_mask].copy().reset_index(drop=True)
    quarantined_df = df[invalid_mask].copy().reset_index(drop=True)

    if len(quarantined_df) > 0:
        logger.warning(f"Quarantined {len(quarantined_df)} invalid rows")
        for r in quarantine_reasons:
            logger.warning(f"  {r['reason']}: {r['count']}")

    return valid_df, quarantined_df, quarantine_reasons


def compute_coverage(
    df: pd.DataFrame,
    now_utc: Optional[datetime] = None,
) -> dict:
    """
    Compute coverage statistics against the full hourly grid.
    Returns quality report dict.
    """
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)

    if len(df) == 0:
        return {
            "expected_hours": 0,
            "actual_rows": 0,
            "coverage_pct": 0.0,
            "missing_ranges": [],
            "zero_volume_bars": 0,
            "per_year_row_counts": {},
        }

    first_ms = int(df["open_time_ms"].min())
    last_ms = int(df["open_time_ms"].max())

    # Expected hours from first to last
    expected = ((last_ms - first_ms) // HOUR_MS) + 1
    actual = len(df)
    coverage = (actual / expected * 100) if expected > 0 else 0.0

    # Find missing ranges
    all_times = set(df["open_time_ms"].values)
    missing_ranges = []
    current_missing_start = None

    t = first_ms
    while t <= last_ms:
        if t not in all_times:
            if current_missing_start is None:
                current_missing_start = t
        else:
            if current_missing_start is not None:
                gap_hours = (t - current_missing_start) // HOUR_MS
                missing_ranges.append({
                    "start_ms": int(current_missing_start),
                    "end_ms": int(t - HOUR_MS),
                    "hours": int(gap_hours),
                })
                current_missing_start = None
        t += HOUR_MS

    # Handle trailing gap
    if current_missing_start is not None:
        gap_hours = (last_ms + HOUR_MS - current_missing_start) // HOUR_MS
        missing_ranges.append({
            "start_ms": int(current_missing_start),
            "end_ms": int(last_ms),
            "hours": int(gap_hours),
        })

    # Zero-volume bars
    zero_vol = int((df["volume"] == 0).sum())

    # Per-year row counts
    # Year from open_time_ms
    years = pd.to_datetime(df["open_time_ms"], unit="ms", utc=True).dt.year
    per_year = years.value_counts().sort_index().to_dict()
    per_year = {str(k): int(v) for k, v in per_year.items()}

    return {
        "expected_hours": int(expected),
        "actual_rows": int(actual),
        "coverage_pct": round(coverage, 4),
        "missing_ranges": missing_ranges,
        "zero_volume_bars": zero_vol,
        "per_year_row_counts": per_year,
    }
