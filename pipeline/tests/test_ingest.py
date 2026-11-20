"""
Tests for pipeline.ingest module.
All tests use synthetic fixtures — no network required.
"""

import hashlib
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from pipeline.ingest import (
    download_and_verify,
    enumerate_current_month_days,
    enumerate_months,
    extract_csv_from_zip,
    has_header,
    ingest,
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


class TestDownloadAndVerify:
    """T1: Cold download, warm cache hit, checksum-mismatch raise, force_refetch bypass."""

    def test_cold_download_increments_checksums_verified(self, tmp_path, monkeypatch, sample_csv_ms):
        zip_bytes = make_zip(sample_csv_ms)
        sha = hashlib.sha256(zip_bytes).hexdigest()
        checksum_bytes = f"{sha}  BTCUSDT-1h-2024-01.zip\n".encode("utf-8")

        def mock_download(client, url):
            if url.endswith(".CHECKSUM"):
                return checksum_bytes
            if url.endswith(".zip"):
                return zip_bytes
            return None

        monkeypatch.setattr("pipeline.ingest.download_with_retry", mock_download)

        stats = {}
        client = MagicMock()
        res = download_and_verify(
            client=client,
            zip_url="http://fake/BTCUSDT-1h-2024-01.zip",
            checksum_url="http://fake/BTCUSDT-1h-2024-01.zip.CHECKSUM",
            cache_dir=tmp_path,
            stats=stats,
            kind="monthly",
        )
        assert res == zip_bytes
        assert stats.get("checksums_verified") == 1
        assert stats.get("source_files") == [
            {"url": "http://fake/BTCUSDT-1h-2024-01.zip", "sha256": sha, "kind": "monthly"}
        ]

    def test_warm_cache_hit_increments_checksums_verified(self, tmp_path, monkeypatch, sample_csv_ms):
        """M1: Cache hit path MUST increment checksums_verified."""
        zip_bytes = make_zip(sample_csv_ms)
        sha = hashlib.sha256(zip_bytes).hexdigest()
        checksum_bytes = f"{sha}  BTCUSDT-1h-2024-01.zip\n".encode("utf-8")

        zip_download_called = False

        def mock_download(client, url):
            nonlocal zip_download_called
            if url.endswith(".CHECKSUM"):
                return checksum_bytes
            if url.endswith(".zip"):
                zip_download_called = True
                return zip_bytes
            return None

        monkeypatch.setattr("pipeline.ingest.download_with_retry", mock_download)

        # First run: cold download to populate cache
        stats1 = {}
        client = MagicMock()
        download_and_verify(
            client=client,
            zip_url="http://fake/BTCUSDT-1h-2024-01.zip",
            checksum_url="http://fake/BTCUSDT-1h-2024-01.zip.CHECKSUM",
            cache_dir=tmp_path,
            stats=stats1,
        )
        assert stats1.get("checksums_verified") == 1
        assert zip_download_called is True

        # Second run: warm cache hit
        zip_download_called = False
        stats2 = {}
        res2 = download_and_verify(
            client=client,
            zip_url="http://fake/BTCUSDT-1h-2024-01.zip",
            checksum_url="http://fake/BTCUSDT-1h-2024-01.zip.CHECKSUM",
            cache_dir=tmp_path,
            stats=stats2,
        )
        assert res2 == zip_bytes
        assert zip_download_called is False  # Never re-downloaded zip
        assert stats2.get("checksums_verified") == 1  # Verified and incremented!

    def test_checksum_mismatch_raises_value_error(self, tmp_path, monkeypatch, sample_csv_ms):
        corrupt_zip = b"corrupted content not matching checksum"
        sha = hashlib.sha256(b"correct expected content").hexdigest()
        checksum_bytes = f"{sha}  BTCUSDT-1h-2024-01.zip\n".encode("utf-8")

        def mock_download(client, url):
            if url.endswith(".CHECKSUM"):
                return checksum_bytes
            return corrupt_zip

        monkeypatch.setattr("pipeline.ingest.download_with_retry", mock_download)

        stats = {}
        client = MagicMock()
        with pytest.raises(ValueError, match="Checksum verification failed after retry"):
            download_and_verify(
                client=client,
                zip_url="http://fake/BTCUSDT-1h-2024-01.zip",
                checksum_url="http://fake/BTCUSDT-1h-2024-01.zip.CHECKSUM",
                cache_dir=tmp_path,
                stats=stats,
            )
        assert stats.get("checksum_failures") == 1

    def test_force_refetch_bypasses_cache(self, tmp_path, monkeypatch, sample_csv_ms):
        zip_bytes = make_zip(sample_csv_ms)
        sha = hashlib.sha256(zip_bytes).hexdigest()
        checksum_bytes = f"{sha}  BTCUSDT-1h-2024-01.zip\n".encode("utf-8")

        zip_downloads = 0

        def mock_download(client, url):
            nonlocal zip_downloads
            if url.endswith(".CHECKSUM"):
                return checksum_bytes
            if url.endswith(".zip"):
                zip_downloads += 1
                return zip_bytes
            return None

        monkeypatch.setattr("pipeline.ingest.download_with_retry", mock_download)

        stats = {}
        client = MagicMock()
        # Seed cache
        download_and_verify(
            client=client,
            zip_url="http://fake/BTCUSDT-1h-2024-01.zip",
            checksum_url="http://fake/BTCUSDT-1h-2024-01.zip.CHECKSUM",
            cache_dir=tmp_path,
            stats=stats,
        )
        assert zip_downloads == 1

        # Force refetch: must re-download zip even though cached
        stats_force = {}
        download_and_verify(
            client=client,
            zip_url="http://fake/BTCUSDT-1h-2024-01.zip",
            checksum_url="http://fake/BTCUSDT-1h-2024-01.zip.CHECKSUM",
            cache_dir=tmp_path,
            force_refetch=True,
            stats=stats_force,
        )
        assert zip_downloads == 2
        assert stats_force.get("checksums_verified") == 1


class TestIngestMonthlyFallback:
    """T2: monthly-404 falls back to daily archives."""

    def test_monthly_404_falls_back_to_daily(self, tmp_path, monkeypatch, sample_csv_ms):
        zip_bytes = make_zip(sample_csv_ms)
        now = datetime(2024, 1, 15, 12, 0, tzinfo=timezone.utc)

        # 1 historical month that 404s
        monkeypatch.setattr("pipeline.ingest.enumerate_months", lambda now_utc: [(2024, 1)])
        # Current month daily list returns empty for simplicity
        monkeypatch.setattr("pipeline.ingest.enumerate_current_month_days", lambda now_utc: [])
        # Fallback days for the 404 month
        monkeypatch.setattr("pipeline.ingest.enumerate_month_days", lambda y, m: ["2024-01-01"])

        def mock_download_and_verify(client, zip_url, checksum_url, cache_dir, force_refetch=False, stats=None, kind=None):
            if "monthly" in zip_url:
                return None  # 404 for monthly
            if "daily" in zip_url:
                if stats is not None:
                    stats["checksums_verified"] = stats.get("checksums_verified", 0) + 1
                    if kind is not None:
                        stats.setdefault("source_files", []).append({
                            "url": zip_url,
                            "sha256": "fake_sha",
                            "kind": kind,
                        })
                return zip_bytes
            return None

        monkeypatch.setattr("pipeline.ingest.download_and_verify", mock_download_and_verify)

        df, stats = ingest(
            out_dir=tmp_path,
            now_utc=now,
        )

        assert len(df) == 3
        assert stats.get("monthly_files", 0) == 0
        assert stats.get("daily_files") == 1
        assert stats.get("checksums_verified") == 1
