# DEVIATIONS.md — Deviations from PLAN.md

This file documents any departures from the PLAN.md specification, with rationale.

## DEV-001: `uv` → `venv + pip` for local development
- **What**: PLAN.md specifies `uv`-managed Python with `uv.lock`. `uv` is not installed on this system.
- **Why**: `uv` is not available; installing it requires elevated permissions the user has not granted.
- **Alternative**: Standard `python -m venv` + `pip` with `requirements.txt` and `requirements-dev.txt` (pinned). Docker images use `pip install` as well. Functionally equivalent for dependency management.
- **Impact**: `uv.lock` replaced by `requirements.txt` / `requirements-dev.txt`. Makefile targets adjusted.

## DEV-002: `docker compose` subcommand → `docker-compose` CLI
- **What**: PLAN.md references `docker compose` (v2 plugin syntax). The system has `docker-compose` CLI available.
- **Why**: Docker on this machine exposes `docker-compose` command.
- **Alternative**: Use `docker-compose` command. Compose file format is identical. README documents both.
- **Impact**: None to functionality; `Makefile` and docs use `docker-compose`.

## DEV-003: `hyparquet` package version pinned to `1.33.1`
- **What**: PLAN.md §4 specifies `hyparquet` without exact minor version or mentions 1.7.1 in initial drafts.
- **Why**: Version `1.7.1` is not published on npm registry; the stable version published is `1.33.1`.
- **Alternative**: Pinned `hyparquet` to `1.33.1`.
- **Impact**: Fully compatible with zero dependencies; Promise-based API `parquetReadObjects({ file })` operates directly.

## DEV-004: All downloaded Binance UM futures files use millisecond timestamps
- **What**: PLAN.md §3 Gotcha 1 noted that files from 2025-01-01 onwards may use microseconds (`> 1e14`).
- **Why**: In runtime ingestion across 82 monthly and 18 daily files (through 2026-11), all timestamps encountered were <= 10^14 (standard millisecond epoch timestamps).
- **Alternative**: Keep runtime auto-detection threshold logic active in `normalize_timestamp()` and record stats in quality report (`files_ms: 100, files_us: 0`).
- **Impact**: Zero rows required microsecond division, but handling remains in place if future archives switch.

## DEV-005: Sample Standard Deviation with Population Moment Skewness & Kurtosis
- **What**: PLAN.md §4 originally referenced standard deviation without distinguishing sample vs population Bessel's correction.
- **Why**: Statistical rigor dictates sample standard deviation with Bessel's correction ($\div(N-1)$) for estimating return volatility from finite window samples, while skewness ($g_1$) and excess kurtosis ($g_2$) are standardized third and fourth central moments defined via population $\sigma_{\text{pop}}$.
- **Alternative**: Implemented sample standard deviation ($\div(N-1)$) for all volatility computations and return summaries, while calculating population moment $g_1/g_2$ internally.
- **Impact**: Volatility metrics accurately estimate population parameters without finite-sample negative bias; rolling volatility cleanly excludes missing bars rather than zero-filling.

## DEV-006: Asynchronous Web Startup & Extended Cold-Start Healthcheck
- **What**: Web service starts concurrently with ETL rather than blocking on strict healthcheck dependency; ETL healthcheck `start_period` set to 300s.
- **Why**: Initial cold startup downloads ~100 historical Binance Vision monthly and daily archive files, which can take up to 3–5 minutes. Enforcing `service_healthy` on `web.depends_on` prematurely marked containers unhealthy and blocked Nginx from booting; the SPA already features built-in retry polling with an interactive loading stepper (`loadArtifactsWithRetry`).
- **Alternative**: `web.depends_on` maintains service ordering (`- etl`) while web boots immediately to display loading feedback; ETL healthcheck `start_period` extended to 300s to allow complete archive downloads before evaluating container health.
- **Impact**: Clean cold boots on fresh volumes without container restarts or premature failure states.

## DEV-007: Gitignoring Build-Generated DuckDB Wasm Assets and Parity Fixtures
- **What**: `web/public/duckdb/` (17.27 MB wasm + 0.25 MB worker) and `verification/fixtures/` (`synthetic_klines.csv`, `parity_cases.json`, `fixture.parquet`) are added to `.gitignore` and untracked from git.
- **Why**: Binary and large generated assets should not bloat the git repository history. Both are deterministically regenerated at build and test time: `web/scripts/copy-duckdb-assets.mjs` automatically copies the DuckDB assets from `node_modules` during `npm run predev` and `npm run prebuild`, while `npm test` (vitest) regenerates `verification/fixtures/` before CI parity execution.
- **Alternative**: Keep assets untracked in version control; rely on `npm run prebuild` and `vitest` in CI/Docker pipelines to generate them on-the-fly.
- **Impact**: Repository stays lightweight without large binary wasm blobs. Zero impact on Docker and CI builds.

## DEV-008: External Verification Kit Comparison Paths, Cache Re-Validation, and Matrix Cell Checks
- **What**: Correction to the Phase C initial report. Three implementation details refined for standalone verification:
  1. Matrix Multi-Cell Comparison: Heatmap definitions (`heatmap.mean_return`, `heatmap.volatility`, `heatmap.win_rate`, `heatmap.total_volume`, `heatmap.taker_buy_ratio`, `heatmap.mean_hl_range`) compare all 168 keyed cells (`d:h`) across the 7×24 grid, resolving an earlier fall-through and verifying genuine non-zero floating point deltas.
  2. Series Summary Statistics: Series definitions (`volatility.rolling_vol`, `flow.cvd`, `calendar.drawdown_series`) compare 4-moment summary statistics `{ n, min, max, mean }`.
  3. Warm-Cache Remote Checksum Re-Validation: `--cache-dir` always re-fetches Binance Vision `.CHECKSUM` files even on a warm cache before using cached ZIP archives.
  4. High-Low Range Convention: `hl_range` standardized strictly to `(high - low) / open` across pipeline, web, and external verification kit.
- **Why**: Rigorous end-to-end verification ensuring zero uninspected numbers and preventing false positives or stale cache usage.
- **Alternative**: Compare every cell of matrices; compare series summaries; re-validate remote checksums on every run.
- **Impact**: 46/46 definitions verified independently with effective tolerance bounds `max(abs, rel * |value|)`.

## DEV-009: Replacement of SQL Playground and Verification Kit with Enumerable-Instance Validation Tables
- **What**: Superceding client-facing surfaces of PLAN-verify.md Phases B/C per PLAN-tables.md. Removal of DuckDB-WASM, SQL Playground tab, SQL parity gate/badges, verification manifest exporter, and external Python verification kit (`verification/`).
- **Why**: Audience is a non-technical client. Independent SQL engine parity and terminal verification scripts created friction and trust barriers. True non-technical client transparency requires enumerable-instance drill-downs, live plain-language recomputations, and direct CSV/Excel exports without SQL engine overhead or binary wasm asset footprint.
- **Alternative**: Dedicated Validation section rendering existing registry definitions via modular Tabulator tables, with instant drill-down to underlying raw OHLCV bars and transparent live formula verification within defined numerical tolerance.
- **Impact**: Reduced client bundle size (~32 kB uncompressed / ~8.8 kB gzip shrink in main chunk, plus elimination of ~208 kB auxiliary wasm chunks and 17.5 MB WASM assets); zero SQL dependency in CI or client runtime; existing `registry.ts` and pipeline provenance fields (`source_files`, `artifact_sha256`) fully preserved.

## DEV-010: Dynamic xlsx Dependency Pinned to Exact 0.18.5 (Write-Only Usage)
- **What**: `xlsx` (SheetJS) is pinned to exact version `0.18.5` in `web/package.json`, along with `tabulator-tables` pinned to exact `6.7.1`.
- **Why**: npm audit warnings identify potential prototype pollution / ReDoS advisories in older SheetJS versions on the *read/parser* path (`XLSX.read` / `XLSX.readFile`). In this application, `xlsx` is used strictly on the *write-only export* path (`XLSX.utils.book_new`, `XLSX.utils.json_to_sheet`, `XLSX.writeFile`) with internally validated and sanitised application data. It is never invoked on user-supplied or untrusted binary spreadsheets, rendering read-side parser vulnerabilities non-applicable. Furthermore, `xlsx` is strictly code-split into an isolated dynamic chunk (`xlsx-*.js`) that is loaded only on an explicit user click of the "Download Excel" button.
- **Alternative**: Retain exact pinned `0.18.5` for client-side multi-sheet Excel generation without introducing bloated or proprietary server-dependent alternatives.
- **Impact**: Zero initial bundle overhead (dynamic import), safe client-side XLSX generation, and no exposure to parser CVE vectors.
