"""
Tests for pipeline.ingest module.
All tests use synthetic fixtures — no network required.
"""

import hashlib
from datetime import datetime, timezone

from pipeline.ingest import (
    enumerate_current_month_days,
    enumerate_months,
    extract_csv_from_zip,
    has_header,
    normalize_timestamp,
    parse_checksum,
    parse_csv,
    verify_checksum,
)
from pipeline.tests.conftest import (
    BASE_TS_MS,
    BASE_TS_US,
    make_zip,
)


class TestEnumerateMonths:
    def test_basic(self):
        now = datetime(2024, 3, 15, tzinfo=timezone.utc)
        months = enumerate_months(now)
        # Should include 2020-01 through 2024-02
        assert months[0] == (2020, 1)
        assert months[-1] == (2024, 2)
        assert (2024, 3) not in months  # current month excluded

    def test_january(self):
        now = datetime(2024, 1, 15, tzinfo=timezone.utc)
        months = enumerate_months(now)
        assert months[-1] == (2023, 12)


class TestEnumerateCurrentMonthDays:
    def test_mid_month(self):
        now = datetime(2024, 3, 15, tzinfo=timezone.utc)
        days = enumerate_current_month_days(now)
        assert len(days) == 14  # days 1-14
        assert days[0] == "2024-03-01"
        assert days[-1] == "2024-03-14"

    def test_first_day(self):
        now = datetime(2024, 3, 1, tzinfo=timezone.utc)
        days = enumerate_current_month_days(now)
        assert len(days) == 0  # no yesterday in this month


class TestTimestampNormalization:
    def test_milliseconds_pass_through(self):
        """Timestamps <= 1e14 are already in ms."""
        assert normalize_timestamp(BASE_TS_MS) == BASE_TS_MS

    def test_microseconds_converted(self):
        """GOTCHA 1: timestamps > 1e14 are µs, divide by 1000."""
        assert normalize_timestamp(BASE_TS_US) == BASE_TS_MS

    def test_boundary(self):
        """Value at boundary: 1e14 exactly is ms (not > 1e14)."""
        val = int(1e14)
        assert normalize_timestamp(val) == val

    def test_just_above_boundary(self):
        val = int(1e14) + 1
        assert normalize_timestamp(val) == val // 1000


class TestHasHeader:
    def test_no_header(self, sample_csv_ms):
        assert has_header(sample_csv_ms) is False

    def test_with_header(self, sample_csv_with_header):
        assert has_header(sample_csv_with_header) is True


class TestParseChecksum:
    def test_standard_format(self):
        result = parse_checksum("abc123def456  BTCUSDT-1h-2024-01.zip\n")
        assert result == "abc123def456"

    def test_whitespace(self):
        result = parse_checksum("  abc123  filename.zip  \n")
        assert result == "abc123"


class TestVerifyChecksum:
    def test_valid(self):
        data = b"test data"
        expected = hashlib.sha256(data).hexdigest()
        assert verify_checksum(data, expected) is True

    def test_invalid(self):
        data = b"test data"
        assert verify_checksum(data, "0" * 64) is False


class TestExtractCsvFromZip:
    def test_extraction(self, sample_csv_ms):
        zip_data = make_zip(sample_csv_ms)
        result = extract_csv_from_zip(zip_data)
        assert result == sample_csv_ms


class TestParseCsv:
    def test_ms_timestamps(self, sample_csv_ms):
        """Parse CSV with millisecond timestamps."""
        stats = {}
        df = parse_csv(sample_csv_ms, stats)
        assert len(df) == 3
        assert df["open_time"].iloc[0] == BASE_TS_MS
        assert stats["files_ms"] == 1
        assert stats.get("files_us", 0) == 0

    def test_us_timestamps(self, sample_csv_us):
        """GOTCHA 1: Parse CSV with microsecond timestamps → normalized to ms."""
        stats = {}
        df = parse_csv(sample_csv_us, stats)
        assert len(df) == 3
        assert df["open_time"].iloc[0] == BASE_TS_MS
        assert stats["files_us"] == 1

    def test_with_header(self, sample_csv_with_header):
        """GOTCHA 2: CSV with header row is handled correctly."""
        stats = {}
        df = parse_csv(sample_csv_with_header, stats)
        assert len(df) == 2
        assert stats["header_files"] == 1
        # First row should be data, not header
        assert df["open_time"].iloc[0] == BASE_TS_MS

    def test_values(self, sample_csv_ms):
        """Verify parsed values match input."""
        df = parse_csv(sample_csv_ms)
        row = df.iloc[0]
        assert row["open"] == 42000.0
        assert row["high"] == 42100.0
        assert row["low"] == 41900.0
        assert row["close"] == 42050.0
        assert row["volume"] == 100.0
        assert row["count"] == 500
