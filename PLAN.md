# PLAN.md — BTCUSDT 1h Analytics Web App (Build Specification)

Source of truth for the implementing agent. Decisions in §2 are LOCKED — do not re-litigate.
Facts in §3 were verified on 2026-11-20; re-verify availability at runtime.

## 1. Mission
A fully functional, Dockerized analytical web app over Binance USDⓈ-M futures BTCUSDT 1h
klines (2020-01 → present, ~60k rows). Product = interactive price charting + honest
statistical seasonality analytics. NOT a trading bot, NOT a signal service.

## 2. Locked decisions
| Decision | Choice |
|---|---|
| Architecture | Python ETL → versioned Parquet artifact → static TS SPA. No backend API, no DB, no auth. |
| Frontend | Vite + TypeScript, TradingView Lightweight Charts v5 (price), Apache ECharts (stats charts) |
| Data scope | BTCUSDT 1h only, full history from 2020-01. Parameterize symbol/interval in config for later multi-symbol. |
| Refresh | Daily, server-side ETL using monthly + daily files. Browser NEVER fetches from Binance at runtime. |
| Time | Store/compute everything in UTC. IST (Asia/Kolkata, UTC+5:30, no DST) is DISPLAY-ONLY on the price chart. Seasonality buckets are always UTC. |
| Aggregations | ETL computes per-row features (tested); browser computes group-bys for instant filtering. |
| Stats | Returns, never raw price levels, for hour/weekday aggregates. Display basis points (bps). Show n everywhere. Tier-3 hypothesis tests use scipy (Phase 4), never hand-rolled. |
| Deploy | Docker compose: `etl` (Python + supercronic) + `web` (nginx serving built SPA + artifacts volume). |

## 3. Data source — verified facts & gotchas
- Files: `https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-YYYY-MM.zip`
  and `.../daily/klines/BTCUSDT/1h/BTCUSDT-1h-YYYY-MM-DD.zip`. Each zip has one CSV; each file has a
  sibling `.CHECKSUM` (sha256, format: `<hex>  <filename>`).
- Coverage verified: monthly 2020-01 … 2026-10 exists (2026-10 published 2026-11-11). ~60k rows, ~3 MB zipped total.
- Cadence: daily files appear the next day; monthly files the first Monday of the next month.
  → Early in a month, last month's monthly zip may 404: fall back to that month's daily files.
- CSV columns (UM futures, in order): open_time, open, high, low, close, volume, close_time,
  quote_volume, count, taker_buy_volume, taker_buy_quote_volume, ignore.
- GOTCHA 1 — timestamp units: files from 2025-01-01 use MICROSECONDS; older use MILLISECONDS.
  Auto-detect per value: > 1e14 → µs, divide by 1000. Never assume by filename alone.
- GOTCHA 2 — header rows: newer CSVs may include a header; older don't. Sniff first line
  (first field non-numeric → skip).
- GOTCHA 3 — gaps/dupes: exchange outages leave missing hours; duplicates possible. Sort, dedupe
  by open_time (keep last), NEVER fabricate/interpolate prices. Record gaps in the quality report.
- CORS is open (`Access-Control-Allow-Origin: *`) but irrelevant: ETL is server-side.

## 4. Repo layout & tooling
    pipeline/            Python 3.12+, uv-managed (uv.lock committed)
      pipeline/run.py    CLI entry: python -m pipeline.run --out ./artifacts
      pipeline/{ingest,transform,validate,export}.py
      tests/             pytest + small synthetic CSV fixtures (NO network in tests)
    web/                 Vite + TS (npm, package-lock committed)
      src/{data,charts,stats,ui}/
      src/stats/*.test.ts  vitest
    analysis/            Phase 4 only (notebooks, scipy/statsmodels) — keep empty until then
    docker/etl.Dockerfile, docker/web.Dockerfile, docker/nginx.conf, docker/crontab
    docker-compose.yml, Makefile, .github/workflows/ci.yml, README.md, DEVIATIONS.md
Libraries: pandas + pyarrow + httpx (or requests) + pytest + ruff for Python;
lightweight-charts ^5, echarts (latest stable), hyparquet for the web. Pin what you install.
Lightweight Charts v5 API notes: `chart.addSeries(CandlestickSeries, opts)` (NOT v4
`addCandlestickSeries`); volume = HistogramSeries on a second pane; times are UTC SECONDS.
Parquet is written UNCOMPRESSED so hyparquet reads it without codec deps; nginx gzips HTTP.

## 5. Data contract (the only ETL↔web interface)
Release dir `artifacts/releases/<run_id>/` with three files; `artifacts/current` symlink
swapped atomically after a fully successful run; keep last 3 releases.

**btcusdt_1h.parquet** (sorted, unique open_time_ms):
| column | type | definition |
|---|---|---|
| open_time_ms | int64 | UTC epoch ms, bar open |
| open/high/low/close | float64 | > 0 |
| volume / quote_volume | float64 | base BTC / USDT |
| trades | int32 | |
| taker_buy_volume / taker_buy_quote_volume | float64 | |
| log_ret | float64, nullable | ln(close_t / close_{t-1}); null for first row or if prev bar not exactly 3,600,000 ms earlier |
| hour | int8 | 0–23 UTC from open_time_ms |
| dow | int8 | 0=Mon … 6=Sun UTC |
| taker_buy_ratio | float64, nullable | taker_buy_volume / volume; null if volume == 0 |
| hl_range | float64 | (high − low) / open |

**meta.json**: schema_version "1.0", symbol, market "um-futures", interval, first_open_ms,
last_open_ms, rows, generated_at_utc, pipeline_git_sha, release_id, files_downloaded
{monthly, daily}, source_base_url.

**quality_report.json**: expected_hours vs actual rows, coverage_pct, missing_ranges
[{start_ms, end_ms, hours}], duplicates_removed, quarantined_rows [{reason, count}],
zero_volume_bars, files_ms vs files_us, header_files, per_year_row_counts,
checksums_verified, warnings [].

## 6. ETL behavior
1. Enumerate months 2020-01 → last completed month (UTC). Try monthly zip; on 404 fall back
   to that month's daily zips (probe days 1–31, tolerate 404). Current month: daily zips for
   days 1 → yesterday.
2. Download `.CHECKSUM` + zip; verify sha256; on mismatch retry once, then ABORT the run
   (keep previous release intact). Sequential or ≤4 concurrent; timeouts; exponential backoff;
   descriptive User-Agent.
3. Cache raw zips in `artifacts/cache/` keyed by URL; reuse if checksum unchanged. Always
   re-fetch the last 3 daily files (they can be revised).
4. Parse per §3 gotchas → normalize open_time to ms → dedupe → sort.
5. Validate: high ≥ max(open,close), low ≤ min(open,close), high ≥ low, prices > 0,
   volume ≥ 0, taker_buy_volume ≤ volume (+tiny epsilon). Quarantine invalid rows (exclude
   from artifact, count in report). Zero-volume bars are valid — keep.
6. Compute features per §5. Completeness check against the full hourly grid; gaps → report only.
7. Export parquet (pyarrow, compression NONE) + meta + report to a temp release dir; fsync;
   atomic symlink swap `current`. Idempotent; a failed run never damages the served release.
8. Exit non-zero on any checksum failure or zero rows; log a human-readable summary.

## 7. Frontend spec
Global controls: date-range presets (1M / 3M / 1Y / All + custom) applied to ALL stats tabs;
UTC↔IST display toggle (price chart only). Dark theme default. Loading/empty/error states;
if artifacts are missing (first ETL still running), show status + auto-retry meta.json.
Fetch order: `/data/current/meta.json` (no-cache) → `btcusdt_1h.parquet` via hyparquet
(`asyncBufferFromUrl` + `parquetReadObjects`). 60k rows: plain main-thread compute is fine;
no Web Worker unless measured need.

**Phase 2 tabs**
1. Price — Lightweight Charts candlestick + volume histogram pane; log-scale toggle;
   crosshair OHLCV tooltip; IST mode = add 19,800 s to display timestamps only, axis labeled
   "IST (UTC+5:30)"; data and stats never shift.
2. Seasonality — ECharts bars for hour-of-day (24) and weekday (7). Metric selector:
   mean return (bps), volatility (σ of log_ret, bps), win rate (share of log_ret > 0),
   total volume, taker buy ratio (ratio-of-sums: Σtaker_buy_volume / Σvolume), mean hl_range.
   Tooltip always shows n. Zero line. Persistent caption: "UTC buckets · returns, not prices ·
   descriptive, not predictive."
3. Data Quality — render meta.json + quality_report.json: coverage, gap table, per-year counts,
   unit/header file stats, provenance.

**Phase 3 tabs**
4. Heatmap — 7×24 (dow × hour) ECharts heatmap, same metric selector, diverging palette
   centered at 0, n in tooltip (~350 obs/cell — caption the noise caveat).
5. Volatility & Distribution — rolling σ (default 168 h window, slider) line chart;
   return histogram + skew/kurtosis/quantiles panel.
6. Flow — taker buy ratio by hour; cumulative taker delta (Σ(2·taker_buy_volume − volume)) line.
7. Calendar & Risk — year × month returns heatmap; drawdown area chart from close.
Session overlay option on seasonality (approx UTC: Asia 00–08, Europe 07–16, US 13–22).

## 8. Statistical rules (non-negotiable)
- Aggregates use log_ret, never price levels. bps = log_ret × 10,000.
- Never compute a return across a gap (log_ret is null there — exclude, don't zero-fill).
- No lookahead: features of bar t use only bars ≤ t.
- Show sample sizes; Phase 4 adds bootstrap CIs, scipy Kruskal–Wallis + Benjamini–Hochberg,
  per-year stability, and an educational fee-slider backtest (default taker fee 5 bps/side).
- README caveats: calendar effects are weak/non-stationary; most are smaller than fees;
  multiple-testing risk. The app informs; it does not advise.

## 9. Ops
- **etl container**: python:3.12-slim + uv + pinned supercronic. Entrypoint: run ETL once
  synchronously, then exec supercronic (`30 3 * * *` UTC daily). Non-root. Volume `artifacts:/data`.
- **web container**: multi-stage — node:22-alpine builds web/ → nginx:alpine. Serves SPA +
  `artifacts` volume read-only at `/data/`. gzip on (include application/octet-stream);
  hashed assets immutable 1y; `/data/current/*` no-cache; SPA fallback; basic security headers.
  Port 8080:80.
- **compose**: `docker compose up --build` → working app with fresh data, no manual steps.
- **CI** (GitHub Actions): job 1 pipeline (uv sync, ruff, pytest — fixtures only, no network);
  job 2 web (npm ci, eslint, tsc --noEmit, vitest run, vite build).
- **Tests**: ETL units for ms/µs, header/no-header, dupes, gap → null log_ret, checksum
  mismatch abort, month-boundary fallback; golden-file transform test. Web: vitest for every
  aggregation function against hand-computed fixtures.
- **Makefile**: setup / data / dev / build / test / lint / up / down / refresh.

## 10. Phases & acceptance criteria
**P1 — Pipeline**: scaffold + ETL + tests + CI.
Accept: one command produces all 3 artifacts; report shows ~60k rows, coverage > 99%,
0 checksum failures, explicit gap list; pytest + ruff green.
**P2 — MVP app**: tabs 1–3 + global controls + Docker compose.
Accept: `docker compose up --build` → localhost:8080 shows full-history candles; date filter
changes seasonality bars; IST toggle shifts axis labels only; quality tab renders; web tests green.
**P3 — Analytics pack**: tabs 4–7 + daily cron verified + README (methodology, formulas,
caveats, run instructions).
Accept: all tabs render correct n; a forced second ETL run swaps releases atomically without
downtime; full CI green.
**P4 — DO NOT BUILD** unless explicitly approved: scipy stats, backtest, funding/OI, multi-symbol.

## 11. Guardrails
- Never fabricate, interpolate, or "fix" price data. Gaps are reported, not filled.
- No runtime browser calls to Binance; no backend API/DB/auth; no new heavy deps without cause.
- Failed refresh must never corrupt or partially replace the served release.
- Any conflict between this plan and reality: document in DEVIATIONS.md (what/why/alternative
  chosen), pick the closest best-practice option, continue. Ask only if truly blocked.
- Definition of done: acceptance criteria met, tests+lint green, one-command run, README complete.