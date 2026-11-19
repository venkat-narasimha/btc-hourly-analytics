"""
CLI entry point: python -m pipeline.run --out ./artifacts

Orchestrates the full ETL pipeline.
"""

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from .export import export
from .ingest import ingest
from .transform import compute_features, dedupe_and_sort, select_output_columns
from .validate import compute_coverage, validate_rows

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger(__name__)


def main() -> int:
    parser = argparse.ArgumentParser(description="BTCUSDT 1h klines ETL pipeline")
    parser.add_argument(
        "--out",
        type=str,
        default="./artifacts",
        help="Output directory for artifacts (default: ./artifacts)",
    )
    args = parser.parse_args()

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    now_utc = datetime.now(timezone.utc)
    logger.info(f"Pipeline starting at {now_utc.isoformat()}")
    logger.info(f"Output directory: {out_dir}")

    try:
        # Phase 1: Ingest
        logger.info("=" * 60)
        logger.info("PHASE: Ingest")
        logger.info("=" * 60)
        raw_df, ingest_stats = ingest(out_dir, now_utc)

        if len(raw_df) == 0:
            logger.error("ABORT: Zero rows ingested")
            return 1

        # Phase 2: Dedupe & Sort
        logger.info("=" * 60)
        logger.info("PHASE: Deduplicate & Sort")
        logger.info("=" * 60)
        deduped_df, dupes_removed = dedupe_and_sort(raw_df)

        # Phase 3: Validate
        logger.info("=" * 60)
        logger.info("PHASE: Validate")
        logger.info("=" * 60)
        valid_df, quarantined_df, quarantine_reasons = validate_rows(deduped_df)

        if len(valid_df) == 0:
            logger.error("ABORT: Zero valid rows after validation")
            return 1

        # Phase 4: Transform (compute features)
        logger.info("=" * 60)
        logger.info("PHASE: Transform")
        logger.info("=" * 60)
        featured_df = compute_features(valid_df)
        output_df = select_output_columns(featured_df)

        # Phase 5: Coverage analysis
        logger.info("=" * 60)
        logger.info("PHASE: Coverage Analysis")
        logger.info("=" * 60)
        coverage = compute_coverage(output_df, now_utc)

        # Phase 6: Export
        logger.info("=" * 60)
        logger.info("PHASE: Export")
        logger.info("=" * 60)
        release_id = export(
            output_df,
            out_dir,
            ingest_stats,
            quarantine_reasons,
            dupes_removed,
            coverage,
        )

        # Summary
        logger.info("=" * 60)
        logger.info("PIPELINE SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Release: {release_id}")
        logger.info(f"Rows: {len(output_df)}")
        logger.info(f"Coverage: {coverage['coverage_pct']:.2f}%")
        logger.info(f"Missing ranges: {len(coverage['missing_ranges'])}")
        logger.info(f"Duplicates removed: {dupes_removed}")
        logger.info(f"Quarantined: {len(quarantined_df)}")
        logger.info(f"Zero-volume bars: {coverage['zero_volume_bars']}")
        logger.info(f"Checksums verified: {ingest_stats['checksums_verified']}")
        logger.info(f"Checksum failures: {ingest_stats['checksum_failures']}")
        logger.info(f"Files (monthly/daily): {ingest_stats['monthly_files']}/{ingest_stats['daily_files']}")
        logger.info(f"Files (ms/µs): {ingest_stats['files_ms']}/{ingest_stats['files_us']}")
        logger.info(f"Per-year counts: {coverage['per_year_row_counts']}")

        return 0

    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
