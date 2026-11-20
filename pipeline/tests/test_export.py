"""
Tests for pipeline.export module.
"""

import json
import os
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
import pytest

from pipeline.export import (
    atomic_release_swap,
    cleanup_old_releases,
    df_to_parquet,
    export,
    write_meta,
    write_quality_report,
)
from pipeline.tests.conftest import BASE_TS_MS, HOUR_MS


@pytest.fixture
def output_df():
    """Minimal valid DataFrame matching the data contract."""
    return pd.DataFrame({
        "open_time_ms": [BASE_TS_MS, BASE_TS_MS + HOUR_MS],
        "open": [42000.0, 42050.0],
        "high": [42100.0, 42200.0],
        "low": [41900.0, 42000.0],
        "close": [42050.0, 42150.0],
        "volume": [100.0, 120.0],
        "quote_volume": [4200000.0, 5040000.0],
        "trades": pd.array([500, 600], dtype="int32"),
        "taker_buy_volume": [60.0, 70.0],
        "taker_buy_quote_volume": [2520000.0, 2940000.0],
        "log_ret": [None, 0.00238],
        "hour": pd.array([0, 1], dtype="int8"),
        "dow": pd.array([0, 0], dtype="int8"),
        "taker_buy_ratio": [0.6, 0.583],
        "hl_range": [0.00476, 0.00476],
    })


class TestDfToParquet:
    def test_writes_valid_parquet(self, output_df, tmp_path):
        path = tmp_path / "test.parquet"
        df_to_parquet(output_df, path)
        assert path.exists()
        # Read back
        table = pq.read_table(str(path))
        assert table.num_rows == 2
        assert "open_time_ms" in table.column_names

    def test_no_compression(self, output_df, tmp_path):
        path = tmp_path / "test.parquet"
        df_to_parquet(output_df, path)
        meta = pq.read_metadata(str(path))
        for i in range(meta.num_row_groups):
            rg = meta.row_group(i)
            for j in range(rg.num_columns):
                col = rg.column(j)
                assert col.compression == "UNCOMPRESSED"


class TestWriteMeta:
    def test_meta_content(self, output_df, tmp_path):
        path = tmp_path / "meta.json"
        source_files = [{"url": "http://fake/m1.zip", "sha256": "abcdef", "kind": "monthly"}]
        stats = {"monthly_files": 10, "daily_files": 5, "source_files": source_files}
        write_meta(output_df, "test_release", stats, path, artifact_sha256="test_hash_123")
        assert path.exists()
        data = json.loads(path.read_text())
        assert data["schema_version"] == "1.0"
        assert data["symbol"] == "BTCUSDT"
        assert data["rows"] == 2
        assert data["release_id"] == "test_release"
        assert data["artifact_sha256"] == "test_hash_123"
        assert data["source_files"] == source_files
        assert data["files_downloaded"]["monthly"] == 10
        assert "freshness_hours" in data
        assert isinstance(data["freshness_hours"], (int, float))


class TestWriteQualityReport:
    def test_report_content(self, tmp_path):
        path = tmp_path / "quality_report.json"
        coverage = {
            "expected_hours": 100,
            "actual_rows": 98,
            "coverage_pct": 98.0,
            "missing_ranges": [],
            "zero_volume_bars": 2,
            "per_year_row_counts": {"2024": 98},
        }
        stats = {"files_ms": 5, "files_us": 3, "header_files": 2, "checksums_verified": 8}
        reasons = [{"reason": "test", "count": 1}]
        write_quality_report(coverage, stats, reasons, 3, path)
        assert path.exists()
        data = json.loads(path.read_text())
        assert data["duplicates_removed"] == 3
        assert data["checksums_verified"] == 8


class TestCleanupOldReleases:
    def test_keeps_only_n(self, tmp_path):
        releases_dir = tmp_path / "releases"
        releases_dir.mkdir()
        for i in range(5):
            (releases_dir / f"release_{i:03d}").mkdir()
        cleanup_old_releases(releases_dir, keep=3)
        remaining = list(releases_dir.iterdir())
        assert len(remaining) == 3


class TestAtomicReleaseSwap:
    def test_current_never_disappears_mid_swap(self, tmp_path, monkeypatch):
        """Verify on POSIX that current remains valid and present throughout the swap."""
        releases_dir = tmp_path / "releases"
        releases_dir.mkdir()
        rel1 = releases_dir / "rel_1"
        rel1.mkdir()
        (rel1 / "meta.json").write_text('{"v": 1}')

        rel2 = releases_dir / "rel_2"
        rel2.mkdir()
        (rel2 / "meta.json").write_text('{"v": 2}')

        current = tmp_path / "current"

        # Track existence of destination 'current' immediately before replace executes
        current_existed_during_replace = []
        real_replace = os.replace

        def monitored_replace(src, dst):
            current_existed_during_replace.append(Path(dst).exists())
            # On Windows host, os.replace over a directory symlink raises WinError 5.
            # Simulate POSIX replace behavior:
            if Path(dst).is_symlink() or Path(dst).exists():
                Path(dst).unlink(missing_ok=True)
            real_replace(src, dst)

        monkeypatch.setattr(os, "name", "posix")
        monkeypatch.setattr(os, "replace", monitored_replace)

        # Initial swap: creates current -> rel_1
        atomic_release_swap(releases_dir, "rel_1", current)
        assert current.exists()

        # Swap to rel_2: must not delete/rename current beforehand
        current_existed_during_replace.clear()
        atomic_release_swap(releases_dir, "rel_2", current)

        # Destination existed at the exact moment of atomic swap
        assert len(current_existed_during_replace) == 1
        assert current_existed_during_replace[0] is True
        assert current.exists()
        assert json.loads((current / "meta.json").read_text())["v"] == 2

    def test_handles_legacy_real_directory(self, tmp_path, monkeypatch):
        """Verify legacy real directory is safely replaced with symlink on POSIX."""
        releases_dir = tmp_path / "releases"
        releases_dir.mkdir()
        rel1 = releases_dir / "rel_1"
        rel1.mkdir()
        (rel1 / "test.txt").write_text("hello")

        current = tmp_path / "current"
        current.mkdir()  # Legacy real directory
        (current / "old.txt").write_text("old")

        monkeypatch.setattr(os, "name", "posix")
        atomic_release_swap(releases_dir, "rel_1", current)
        assert current.exists()


class TestExport:
    def test_full_export(self, output_df, tmp_path):
        coverage = {
            "expected_hours": 2,
            "actual_rows": 2,
            "coverage_pct": 100.0,
            "missing_ranges": [],
            "zero_volume_bars": 0,
            "per_year_row_counts": {"2024": 2},
        }
        stats = {"monthly_files": 1, "daily_files": 0, "files_ms": 1, "files_us": 0,
                 "header_files": 0, "checksums_verified": 1}
        reasons = []

        release_id = export(output_df, tmp_path, stats, reasons, 0, coverage)

        # Check release dir exists
        release_dir = tmp_path / "releases" / release_id
        assert release_dir.exists()
        assert (release_dir / "btcusdt_1h.parquet").exists()
        assert (release_dir / "meta.json").exists()
        assert (release_dir / "quality_report.json").exists()

        # Check current link/dir exists
        current = tmp_path / "current"
        assert current.exists()

        # Check artifact_sha256 in meta matches actual parquet file
        meta_data = json.loads((release_dir / "meta.json").read_text())
        import hashlib
        expected_sha = hashlib.sha256((release_dir / "btcusdt_1h.parquet").read_bytes()).hexdigest()
        assert meta_data["artifact_sha256"] == expected_sha
