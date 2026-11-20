"""
Export module: write parquet, meta.json, quality_report.json.

Implements atomic release swap per §6 step 7.
"""

import hashlib
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
    """Get current git commit SHA from env or git CLI, or 'unknown'."""
    sha = os.environ.get("GIT_SHA")
    if sha and sha.strip() and sha != "unknown":
        return sha.strip()
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
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
    artifact_sha256: str = "",
) -> dict:
    """Write meta.json per §5."""
    now_utc = datetime.now(timezone.utc)
    last_open_ms = int(df["open_time_ms"].max())
    last_open_dt = datetime.fromtimestamp(last_open_ms / 1000, tz=timezone.utc)
    freshness_hours = round((now_utc - last_open_dt).total_seconds() / 3600, 1)

    meta = {
        "schema_version": "1.0",
        "symbol": SYMBOL,
        "market": MARKET,
        "interval": INTERVAL,
        "first_open_ms": int(df["open_time_ms"].min()),
        "last_open_ms": last_open_ms,
        "freshness_hours": freshness_hours,
        "rows": len(df),
        "generated_at_utc": now_utc.isoformat(),
        "pipeline_git_sha": get_git_sha(),
        "release_id": release_id,
        "artifact_sha256": artifact_sha256,
        "source_files": ingest_stats.get("source_files", []),
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


def fsync_release_dir(release_dir: Path) -> None:
    """Flush and fsync all written files and directory metadata in release_dir."""
    for file_path in release_dir.iterdir():
        if file_path.is_file():
            try:
                with open(file_path, "r+b") as f:
                    os.fsync(f.fileno())
            except OSError as e:
                logger.warning(f"Failed to fsync {file_path}: {e}")
    if hasattr(os, "O_DIRECTORY") and os.name != "nt":
        try:
            dir_fd = os.open(str(release_dir), os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except OSError:
            pass


def atomic_release_swap(releases_dir: Path, release_id: str, current_link: Path) -> None:
    """
    Atomically swap the 'current' symlink to point to the new release.
    On POSIX, replaces the two-step rename with a single atomic os.replace(temp_symlink, current_link).
    Handles legacy 'current' if it is a real directory (removes once, then os.replace).
    On Windows (os.name == 'nt'), keeps the copy/directory fallback.
    """
    target = releases_dir / release_id
    temp_link = current_link.parent / f"current_tmp_{release_id}"

    # Clean up any leftover temporary symlink before starting
    if temp_link.exists() or temp_link.is_symlink():
        if temp_link.is_dir() and not temp_link.is_symlink():
            shutil.rmtree(temp_link)
        else:
            temp_link.unlink()

    if os.name != "nt":
        # POSIX implementation: single atomic os.replace
        try:
            # Handle legacy 'current' being a real directory (remove once before os.replace)
            if current_link.exists() and not current_link.is_symlink() and current_link.is_dir():
                shutil.rmtree(current_link)

            # Create temporary symlink pointing to release dir
            os.symlink(str(target), str(temp_link), target_is_directory=True)

            # Single atomic replace: current_link atomically points to target without mid-swap disappearance
            os.replace(temp_link, current_link)
            logger.info(f"Release swapped (atomic POSIX symlink): current -> {release_id}")
            return
        except OSError as e:
            logger.warning(f"POSIX atomic symlink failed: {e}, falling back to copy")
            if temp_link.exists() or temp_link.is_symlink():
                try:
                    if temp_link.is_dir() and not temp_link.is_symlink():
                        shutil.rmtree(temp_link)
                    else:
                        temp_link.unlink()
                except OSError:
                    pass

    # Windows fallback (or POSIX exception fallback)
    try:
        try:
            os.symlink(str(target), str(temp_link), target_is_directory=True)
            if current_link.exists() or current_link.is_symlink():
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
            logger.info(f"Release swapped (Windows symlink): current -> {release_id}")
            return
        except OSError:
            pass

        # Windows directory copy fallback
        logger.warning("Symlink unavailable, using directory copy fallback for 'current'")
        if current_link.exists():
            if current_link.is_dir() and not current_link.is_symlink():
                shutil.rmtree(current_link)
            elif current_link.is_symlink():
                current_link.unlink()
        shutil.copytree(str(target), str(current_link))
        logger.info(f"Release swapped (Windows copy): current -> {release_id}")
    finally:
        if temp_link.exists() or temp_link.is_symlink():
            try:
                if temp_link.is_dir() and not temp_link.is_symlink():
                    shutil.rmtree(temp_link)
                else:
                    temp_link.unlink()
            except OSError:
                pass


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
    parquet_path = release_dir / "btcusdt_1h.parquet"
    df_to_parquet(df, parquet_path)
    artifact_sha256 = hashlib.sha256(parquet_path.read_bytes()).hexdigest()
    write_meta(df, release_id, ingest_stats, release_dir / "meta.json", artifact_sha256=artifact_sha256)
    write_quality_report(
        coverage, ingest_stats, quarantine_reasons, duplicates_removed,
        release_dir / "quality_report.json",
    )

    # Fsync all written release files before swap
    fsync_release_dir(release_dir)

    # Atomic swap
    current_link = out_dir / "current"
    atomic_release_swap(releases_dir, release_id, current_link)

    # Cleanup old
    cleanup_old_releases(releases_dir)

    logger.info(f"Export complete: release {release_id}")
    return release_id
