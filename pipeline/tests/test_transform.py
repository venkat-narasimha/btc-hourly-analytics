"""
Tests for pipeline.transform module.
Hand-computed expected values for golden-file style verification.
"""

import math

import pandas as pd

from pipeline.tests.conftest import BASE_TS_MS, HOUR_MS
from pipeline.transform import compute_features, dedupe_and_sort, select_output_columns


class TestDedupeAndSort:
    def test_removes_duplicates(self, sample_csv_with_dupes):
        """GOTCHA 3: Duplicate open_time rows — keep last."""
        from pipeline.ingest import parse_csv

        df = parse_csv(sample_csv_with_dupes)
        result, dupes = dedupe_and_sort(df)
        assert dupes == 1
        assert len(result) == 2
        # The kept row for BASE_TS_MS should be the LAST one (open=42010)
        row = result[result["open_time"] == BASE_TS_MS].iloc[0]
        assert row["open"] == 42010.0

    def test_sorts_by_time(self):
        """Out-of-order rows are sorted."""
        data = {
            "open_time": [BASE_TS_MS + 2 * HOUR_MS, BASE_TS_MS, BASE_TS_MS + HOUR_MS],
            "open": [42150, 42000, 42050],
            "high": [42300, 42100, 42200],
            "low": [42050, 41900, 42000],
            "close": [42100, 42050, 42150],
            "volume": [80, 100, 120],
            "close_time": [0, 0, 0],
            "quote_volume": [0, 0, 0],
            "count": [0, 0, 0],
            "taker_buy_volume": [0, 0, 0],
            "taker_buy_quote_volume": [0, 0, 0],
            "ignore": ["0", "0", "0"],
        }
        df = pd.DataFrame(data)
        result, dupes = dedupe_and_sort(df)
        assert dupes == 0
        assert result["open_time"].iloc[0] == BASE_TS_MS
        assert result["open_time"].iloc[2] == BASE_TS_MS + 2 * HOUR_MS


class TestComputeFeatures:
    def test_log_ret_consecutive(self, sample_df):
        """log_ret = ln(close_t / close_{t-1}) for consecutive bars."""
        df = compute_features(sample_df)
        # First row: NaN (no previous)
        assert pd.isna(df["log_ret"].iloc[0])
        # Second row: ln(42100 / 42050)
        expected = math.log(42100.0 / 42050.0)
        assert abs(df["log_ret"].iloc[1] - expected) < 1e-10

    def test_log_ret_gap_is_null(self, sample_csv_with_gap):
        """log_ret is null across a gap (not exactly 1 hour)."""
        from pipeline.ingest import parse_csv

        raw = parse_csv(sample_csv_with_gap)
        df = compute_features(raw)
        # Row at index 1 has a gap before it → null log_ret
        assert pd.isna(df["log_ret"].iloc[1])

    def test_hour(self, sample_df):
        """hour = 0-23 UTC from open_time_ms."""
        df = compute_features(sample_df)
        # BASE_TS_MS = 2024-01-01 00:00 UTC → hour 0
        assert df["hour"].iloc[0] == 0
        assert df["hour"].iloc[1] == 1
        assert df["hour"].iloc[2] == 2

    def test_dow(self, sample_df):
        """dow = 0=Mon..6=Sun. 2024-01-01 is a Monday."""
        df = compute_features(sample_df)
        assert df["dow"].iloc[0] == 0  # Monday

    def test_taker_buy_ratio(self, sample_df):
        """taker_buy_ratio = taker_buy_volume / volume."""
        df = compute_features(sample_df)
        expected = 60.0 / 100.0  # First row
        assert abs(df["taker_buy_ratio"].iloc[0] - expected) < 1e-10

    def test_taker_buy_ratio_zero_volume(self, sample_csv_zero_volume):
        """taker_buy_ratio is null when volume == 0."""
        from pipeline.ingest import parse_csv

        raw = parse_csv(sample_csv_zero_volume)
        df = compute_features(raw)
        assert pd.isna(df["taker_buy_ratio"].iloc[0])

    def test_hl_range(self, sample_df):
        """hl_range = (high - low) / open."""
        df = compute_features(sample_df)
        expected = (42100.0 - 41900.0) / 42000.0
        assert abs(df["hl_range"].iloc[0] - expected) < 1e-10

    def test_column_rename(self, sample_df):
        """open_time → open_time_ms, count → trades."""
        df = compute_features(sample_df)
        assert "open_time_ms" in df.columns
        assert "trades" in df.columns
        assert "open_time" not in df.columns
        assert "count" not in df.columns


class TestSelectOutputColumns:
    def test_correct_columns(self, sample_df):
        """Output has exactly the data contract columns."""
        from pipeline.config import PARQUET_COLUMNS

        df = compute_features(sample_df)
        output = select_output_columns(df)
        assert list(output.columns) == PARQUET_COLUMNS
