"""
Tests for pipeline.validate module.
"""

import pandas as pd

from pipeline.tests.conftest import BASE_TS_MS, HOUR_MS
from pipeline.validate import compute_coverage, validate_rows


class TestValidateRows:
    def test_valid_rows_pass(self, invalid_rows_df):
        """Valid rows are kept, invalid are quarantined."""
        valid, quarantined, reasons = validate_rows(invalid_rows_df)
        assert len(valid) == 1  # only the first row is valid
        assert len(quarantined) == 3
        assert len(reasons) > 0

    def test_negative_price_quarantined(self):
        """Row with open <= 0 is quarantined."""
        df = pd.DataFrame([{
            "open_time_ms": BASE_TS_MS, "open": -1.0, "high": 42100.0,
            "low": 41900.0, "close": 42050.0, "volume": 100.0,
            "quote_volume": 4200000.0, "trades": 500,
            "taker_buy_volume": 60.0, "taker_buy_quote_volume": 2520000.0,
            "log_ret": None, "hour": 0, "dow": 0,
            "taker_buy_ratio": 0.6, "hl_range": 0.00476,
        }])
        valid, quarantined, reasons = validate_rows(df)
        assert len(valid) == 0
        assert len(quarantined) == 1
        assert any("open <= 0" in r["reason"] for r in reasons)

    def test_high_less_than_low_quarantined(self):
        """Row where high < low is quarantined."""
        df = pd.DataFrame([{
            "open_time_ms": BASE_TS_MS, "open": 42000.0, "high": 41800.0,
            "low": 42200.0, "close": 42050.0, "volume": 100.0,
            "quote_volume": 4200000.0, "trades": 500,
            "taker_buy_volume": 60.0, "taker_buy_quote_volume": 2520000.0,
            "log_ret": None, "hour": 0, "dow": 0,
            "taker_buy_ratio": 0.6, "hl_range": -0.00952,
        }])
        valid, quarantined, reasons = validate_rows(df)
        assert len(valid) == 0
        assert len(quarantined) == 1

    def test_taker_buy_exceeds_volume_quarantined(self):
        """Row where taker_buy_volume > volume is quarantined."""
        df = pd.DataFrame([{
            "open_time_ms": BASE_TS_MS, "open": 42000.0, "high": 42100.0,
            "low": 41900.0, "close": 42050.0, "volume": 50.0,
            "quote_volume": 4200000.0, "trades": 500,
            "taker_buy_volume": 100.0, "taker_buy_quote_volume": 2520000.0,
            "log_ret": None, "hour": 0, "dow": 0,
            "taker_buy_ratio": 2.0, "hl_range": 0.00476,
        }])
        valid, quarantined, reasons = validate_rows(df)
        assert len(valid) == 0

    def test_zero_volume_valid(self):
        """Zero-volume bars are valid — keep."""
        df = pd.DataFrame([{
            "open_time_ms": BASE_TS_MS, "open": 42000.0, "high": 42000.0,
            "low": 42000.0, "close": 42000.0, "volume": 0.0,
            "quote_volume": 0.0, "trades": 0,
            "taker_buy_volume": 0.0, "taker_buy_quote_volume": 0.0,
            "log_ret": None, "hour": 0, "dow": 0,
            "taker_buy_ratio": None, "hl_range": 0.0,
        }])
        valid, quarantined, reasons = validate_rows(df)
        assert len(valid) == 1
        assert len(quarantined) == 0


class TestComputeCoverage:
    def test_full_coverage(self):
        """3 consecutive hours → 100% coverage, no gaps."""
        df = pd.DataFrame({
            "open_time_ms": [BASE_TS_MS, BASE_TS_MS + HOUR_MS, BASE_TS_MS + 2 * HOUR_MS],
            "volume": [100.0, 120.0, 80.0],
        })
        result = compute_coverage(df)
        assert result["expected_hours"] == 3
        assert result["actual_rows"] == 3
        assert result["coverage_pct"] == 100.0
        assert len(result["missing_ranges"]) == 0

    def test_gap_detected(self):
        """Gap of 1 hour in the middle."""
        df = pd.DataFrame({
            "open_time_ms": [BASE_TS_MS, BASE_TS_MS + 2 * HOUR_MS],
            "volume": [100.0, 80.0],
        })
        result = compute_coverage(df)
        assert result["expected_hours"] == 3
        assert result["actual_rows"] == 2
        assert result["coverage_pct"] < 100.0
        assert len(result["missing_ranges"]) == 1
        assert result["missing_ranges"][0]["hours"] == 1

    def test_zero_volume_counted(self):
        """Zero-volume bars are counted."""
        df = pd.DataFrame({
            "open_time_ms": [BASE_TS_MS],
            "volume": [0.0],
        })
        result = compute_coverage(df)
        assert result["zero_volume_bars"] == 1

    def test_per_year_counts(self):
        """Per-year row counts are computed."""
        # 2024-01-01 00:00 UTC
        df = pd.DataFrame({
            "open_time_ms": [BASE_TS_MS, BASE_TS_MS + HOUR_MS],
            "volume": [100.0, 120.0],
        })
        result = compute_coverage(df)
        assert "2024" in result["per_year_row_counts"]
        assert result["per_year_row_counts"]["2024"] == 2
