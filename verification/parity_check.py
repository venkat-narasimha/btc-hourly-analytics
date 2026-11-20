#!/usr/bin/env python3
"""
CI Parity Check Runner.
Executes DuckDB SQL queries for all definition registry cases against fixture.parquet
and asserts numerical parity within defined relative and absolute tolerances.

Rules:
- Runs in CI without a browser.
- Tests the verification feature itself.
- Exits 0 if all parity checks pass; 1 if any fail.
"""

import json
import math
import sys
from pathlib import Path
import duckdb

FIXTURES_DIR = Path(__file__).parent / "fixtures"
CSV_PATH = FIXTURES_DIR / "synthetic_klines.csv"
PARQUET_PATH = FIXTURES_DIR / "fixture.parquet"
CASES_PATH = FIXTURES_DIR / "parity_cases.json"


def is_within_tolerance(a, b, rel_tol=1e-9, abs_tol=1e-9) -> tuple[bool, float]:
    """Returns (is_match, diff) based on |a - b| <= max(abs_tol, rel_tol * max(|a|, |b|))."""
    if a is None or (isinstance(a, float) and math.isnan(a)):
        is_b_none = b is None or (isinstance(b, float) and math.isnan(b))
        return is_b_none, (0.0 if is_b_none else float("inf"))
    if b is None or (isinstance(b, float) and math.isnan(b)):
        return False, float("inf")

    num_a = float(a)
    num_b = float(b)
    diff = abs(num_a - num_b)
    max_val = max(abs(num_a), abs(num_b))
    max_allowed = max(abs_tol, rel_tol * max_val)
    return diff <= max_allowed, diff


def ensure_fixture_parquet(con: duckdb.DuckDBPyConnection) -> None:
    """Creates fixture.parquet from synthetic_klines.csv and registers klines view."""
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Fixture CSV not found at {CSV_PATH}. Run vitest first.")

    csv_posix = CSV_PATH.as_posix()
    parquet_posix = PARQUET_PATH.as_posix()

    con.execute(f"""
        CREATE TABLE raw_klines AS SELECT
            CAST(open_time_ms AS BIGINT) AS open_time_ms,
            CAST(open AS DOUBLE) AS open,
            CAST(high AS DOUBLE) AS high,
            CAST(low AS DOUBLE) AS low,
            CAST(close AS DOUBLE) AS close,
            CAST(volume AS DOUBLE) AS volume,
            CAST(quote_volume AS DOUBLE) AS quote_volume,
            CAST(trades AS BIGINT) AS trades,
            CAST(taker_buy_volume AS DOUBLE) AS taker_buy_volume,
            CAST(taker_buy_quote_volume AS DOUBLE) AS taker_buy_quote_volume,
            CAST(log_ret AS DOUBLE) AS log_ret,
            CAST(hour AS BIGINT) AS hour,
            CAST(dow AS BIGINT) AS dow,
            CAST(taker_buy_ratio AS DOUBLE) AS taker_buy_ratio,
            CAST(hl_range AS DOUBLE) AS hl_range
        FROM read_csv('{csv_posix}', header=True);
    """)

    con.execute(f"COPY raw_klines TO '{parquet_posix}' (FORMAT PARQUET);")
    con.execute(f"CREATE VIEW klines AS SELECT * FROM parquet_scan('{parquet_posix}');")


def main() -> int:
    if not CASES_PATH.exists():
        print(f"ERROR: Parity cases file not found at {CASES_PATH}")
        return 1

    with open(CASES_PATH, "r", encoding="utf-8") as f:
        cases = json.load(f)

    con = duckdb.connect()
    ensure_fixture_parquet(con)

    print(f"Loaded {len(cases)} parity check cases from {CASES_PATH.name}")
    print(f"Parquet artifact created at {PARQUET_PATH.name}")
    print("-" * 88)
    print(f"{'Metric Case ID':<35} | {'Kind':<8} | {'Items':<7} | {'Max Δ':<12} | {'Status'}")
    print("-" * 88)

    passed_count = 0
    failed_count = 0
    failures = []

    for case in cases:
        case_id = case["id"]
        kind = case["kind"]
        sql = case["sql"]
        expected = case["expected"]
        tol = case.get("tolerance", {"rel": 1e-9, "abs": 1e-9})
        rel_tol = tol.get("rel", 1e-9)
        abs_tol = tol.get("abs", 1e-9)

        try:
            rel = con.execute(sql)
            col_names = [desc[0] for desc in con.description]
            raw_rows = rel.fetchall()
            sql_rows = [dict(zip(col_names, row)) for row in raw_rows]
        except Exception as e:
            failed_count += 1
            print(f"{case_id:<35} | {kind:<8} | {'0':<7} | {'ERROR':<12} | FAIL (SQL: {e})")
            failures.append((case_id, f"SQL Error: {e}"))
            continue

        matched = 0
        total = 0
        max_delta = 0.0

        if case_id.startswith("volatility.histogram"):
            # Summary-only parity (PLAN-verify.md §5): n, min, max
            sql_row = sql_rows[0] if sql_rows else {}
            trace = expected.get("trace", {})
            total_bars = sum(k.get("n", 0) for k in expected.get("keys", []))

            checks = [
                ("n", total_bars, sql_row.get("n")),
                ("min", trace.get("min_bps"), sql_row.get("min")),
                ("max", trace.get("max_bps"), sql_row.get("max")),
            ]

            for key, app_val, sql_val in checks:
                total += 1
                ok, diff = is_within_tolerance(app_val, sql_val, rel_tol, abs_tol)
                if diff < float("inf") and diff > max_delta:
                    max_delta = diff
                if ok:
                    matched += 1
        elif kind == "scalar":
            total = 1
            app_val = expected.get("value")
            sql_val = sql_rows[0].get("value") if sql_rows else None
            ok, diff = is_within_tolerance(app_val, sql_val, rel_tol, abs_tol)
            if diff < float("inf"):
                max_delta = diff
            if ok:
                matched = 1
        elif kind in ("grouped", "matrix"):
            sql_map = {}
            for r in sql_rows:
                k = str(r.get("key", r.get("bucket", "")))
                v = r.get("value")
                sql_map[k] = v

            app_keys = expected.get("keys", [])
            total = len(app_keys)

            for item in app_keys:
                k = str(item.get("key"))
                app_val = item.get("value")
                sql_val = sql_map.get(k)
                ok, diff = is_within_tolerance(app_val, sql_val, rel_tol, abs_tol)
                if diff < float("inf") and diff > max_delta:
                    max_delta = diff
                if ok:
                    matched += 1
        elif kind == "series":
            sql_map = {}
            for r in sql_rows:
                t = int(r.get("timeMs", r.get("open_time_ms", 0)))
                v = r.get("value")
                sql_map[t] = v

            app_points = expected.get("points", [])
            total = len(app_points)

            for pt in app_points:
                t = int(pt.get("timeMs"))
                app_val = pt.get("value")
                sql_val = sql_map.get(t)
                ok, diff = is_within_tolerance(app_val, sql_val, rel_tol, abs_tol)
                if diff < float("inf") and diff > max_delta:
                    max_delta = diff
                if ok:
                    matched += 1

        is_all_match = (matched == total and total > 0)
        status_str = "PASS" if is_all_match else "FAIL"

        delta_str = f"{max_delta:.2e}" if max_delta > 0 else "0.00"
        items_str = f"{matched}/{total}"
        print(f"{case_id:<35} | {kind:<8} | {items_str:<7} | {delta_str:<12} | {status_str}")

        if is_all_match:
            passed_count += 1
        else:
            failed_count += 1
            failures.append((case_id, f"Matched {matched}/{total}, max delta: {max_delta}"))

    print("-" * 88)
    print(f"Summary: {passed_count} PASSED, {failed_count} FAILED out of {len(cases)} cases.")

    if failures:
        print("\nFailures:")
        for fid, msg in failures:
            print(f"  - {fid}: {msg}")
        return 1

    print("\n✓ Dual-engine parity fully verified across all definitions!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
