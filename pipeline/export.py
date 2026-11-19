"""
Export module: write parquet, meta.json, quality_report.json.

Implements atomic release swap per §6 step 7.
"""

import json
import logging
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .config import (
    BASE_URL,
    INTERVAL,
    MARKET,
    MAX_RELEASES,
    PARQUET_COLUMNS,
    SYMBOL,
)

logger = logging.getLogger(__name__)


def get_git_sha() -> str:
    """Get current git commit SHA, or 'unknown'."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return "unknown"


def df_to_parquet(df: pd.DataFrame, path: Path) -> None:
    """Write DataFrame to Parquet with NONE compression per §4."""
    # Define the schema with correct types
    schema = pa.schema([
        ("open_time_ms", pa.int64()),
        ("open", pa.float64()),
        ("high", pa.float64()),
        ("low", pa.float64()),
        ("close", pa.float64()),
        ("volume", pa.float64()),
        ("quote_volume", pa.float64()),
        ("trades", pa.int32()),
        ("taker_buy_volume", pa.float64()),
        ("taker_buy_quote_volume", pa.float64()),
        ("log_ret", pa.float64()),  # nullable
        ("hour", pa.int8()),
        ("dow", pa.int8()),
        ("taker_buy_ratio", pa.float64()),  # nullable
        ("hl_range", pa.float64()),
    ])

    table = pa.Table.from_pandas(df[PARQUET_COLUMNS], schema=schema, preserve_index=False)
    pq.write_table(table, str(path), compression="NONE")
    logger.info(f"Wrote parquet: {path} ({len(df)} rows, {path.stat().st_size} bytes)")


def write_meta(
    df: pd.DataFrame,
    release_id: str,
    ingest_stats: dict,
    out_path: Path,
) -> dict:
    """Write meta.json per §5."""
    meta = {
        "schema_version": "1.0",
        "symbol": SYMBOL,
        "market": MARKET,
        "interval": INTERVAL,
        "first_open_ms": int(df["open_time_ms"].min()),
        "last_open_ms": int(df["open_time_ms"].max()),
        "rows": len(df),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "pipeline_git_sha": get_git_sha(),
        "release_id": release_id,
        "files_downloaded": {
            "monthly": ingest_stats.get("monthly_files", 0),
            "daily": ingest_stats.get("daily_files", 0),
        },
        "source_base_url": BASE_URL,
    }
    out_path.write_text(json.dumps(meta, indent=2))
    logger.info(f"Wrote meta.json: {out_path}")
    return meta


def write_quality_report(
    coverage: dict,
    ingest_stats: dict,
    quarantine_reasons: list[dict],
    duplicates_removed: int,
    out_path: Path,
) -> dict:
    """Write quality_report.json per §5."""
    report = {
        "expected_hours": coverage["expected_hours"],
        "actual_rows": coverage["actual_rows"],
        "coverage_pct": coverage["coverage_pct"],
        "missing_ranges": coverage["missing_ranges"],
        "duplicates_removed": duplicates_removed,
        "quarantined_rows": quarantine_reasons,
        "zero_volume_bars": coverage["zero_volume_bars"],
        "files_ms": ingest_stats.get("files_ms", 0),
        "files_us": ingest_stats.get("files_us", 0),
        "header_files": ingest_stats.get("header_files", 0),
        "per_year_row_counts": coverage["per_year_row_counts"],
        "checksums_verified": ingest_stats.get("checksums_verified", 0),
        "warnings": [],
    }
    out_path.write_text(json.dumps(report, indent=2))
    logger.info(f"Wrote quality_report.json: {out_path}")
    return report


def atomic_release_swap(releases_dir: Path, release_id: str, current_link: Path) -> None:
    """
    Atomically swap the 'current' symlink to point to the new release.
    On Windows, use directory junction or just rename.
    """
    target = releases_dir / release_id

    # On Windows, symlinks may need admin. Use junction or just write a redirect file.
    # For cross-platform: try symlink, fallback to writing a text file.
    temp_link = current_link.parent / f"current_tmp_{release_id}"

    try:
        if temp_link.exists() or temp_link.is_symlink():
            if temp_link.is_dir() and not temp_link.is_symlink():
                shutil.rmtree(temp_link)
            else:
                temp_link.unlink()

        # Try creating a symlink (or junction on Windows)
        os.symlink(str(target), str(temp_link), target_is_directory=True)
        # Atomic rename
        if current_link.exists() or current_link.is_symlink():
            # On Windows, can't atomically rename over existing symlink
            old_link = current_link.parent / f"current_old_{release_id}"
            if old_link.exists() or old_link.is_symlink():
                if old_link.is_dir() and not old_link.is_symlink():
                    shutil.rmtree(old_link)
                else:
                    old_link.unlink()
            current_link.rename(old_link)
            temp_link.rename(current_link)
            if old_link.exists() or old_link.is_symlink():
                if old_link.is_dir() and not old_link.is_symlink():
                    shutil.rmtree(old_link)
                else:
                    old_link.unlink()
        else:
            temp_link.rename(current_link)
    except OSError:
        # Fallback: just copy the directory or use a pointer file
        logger.warning("Symlink failed, using copy fallback for 'current'")
        if current_link.exists():
            if current_link.is_dir() and not current_link.is_symlink():
                shutil.rmtree(current_link)
            elif current_link.is_symlink():
                current_link.unlink()
        shutil.copytree(str(target), str(current_link))

    logger.info(f"Release swapped: current → {release_id}")


def cleanup_old_releases(releases_dir: Path, keep: int = MAX_RELEASES) -> None:
    """Remove oldest releases, keeping only `keep` most recent."""
    if not releases_dir.exists():
        return
    releases = sorted(
        [d for d in releases_dir.iterdir() if d.is_dir()],
        key=lambda d: d.name,
    )
    while len(releases) > keep:
        old = releases.pop(0)
        logger.info(f"Removing old release: {old.name}")
        shutil.rmtree(old)


def export(
    df: pd.DataFrame,
    out_dir: Path,
    ingest_stats: dict,
    quarantine_reasons: list[dict],
    duplicates_removed: int,
    coverage: dict,
) -> str:
    """
    Full export: write parquet + meta + report to a new release dir,
    then atomically swap 'current' symlink.
    Returns release_id.
    """
    release_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    releases_dir = out_dir / "releases"
    releases_dir.mkdir(parents=True, exist_ok=True)

    release_dir = releases_dir / release_id
    release_dir.mkdir(parents=True, exist_ok=True)

    # Write artifacts
    df_to_parquet(df, release_dir / "btcusdt_1h.parquet")
    write_meta(df, release_id, ingest_stats, release_dir / "meta.json")
    write_quality_report(
        coverage, ingest_stats, quarantine_reasons, duplicates_removed,
        release_dir / "quality_report.json",
    )

    # Atomic swap
    current_link = out_dir / "current"
    atomic_release_swap(releases_dir, release_id, current_link)

    # Cleanup old
    cleanup_old_releases(releases_dir)

    logger.info(f"Export complete: release {release_id}")
    return release_id
