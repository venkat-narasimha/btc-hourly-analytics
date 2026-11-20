# BTC Hourly Analytics — Verification Kit

> **Philosophy**: "Every Number Shows Its Work." Let any skeptic, researcher, or auditor verify any published statistic independently from source archives, with zero trust required in the web client, pipeline code, or third-party analytical packages.

---

## 1. Three Levels of Verification Independence

1. **Level 1: Explain (Inspect Drawer)**
   - Click the inspect icon on any KPI card, chart header, heatmap cell, seasonality bar, or calendar cell in the web application.
   - Inspect the exact canonical formula, statistical conventions, filter scope, computation trace intermediates ($\sum r$, $\sum r^2$, volume aggregates), underlying rows, and download deterministic subset CSVs.
   - *Proves*: Proper code wiring and transparency.

2. **Level 2: Cross-Check (DuckDB-WASM In-Browser SQL)**
   - Inside the inspect drawer or the dedicated **Playground** tab, DuckDB runs an equivalent parameterized SQL query directly over the served Parquet dataset in WebAssembly.
   - Validates dual-engine parity ($\Delta \le 10^{-9}$) across mathematical engines.
   - *Proves*: Analytical implementation correctness against standard relational database algebra.

3. **Level 3: External Kit (`verify_release.py`)**
   - Download the client-generated `verification_manifest.json` from the Data Quality tab.
   - Run the standalone Python script to re-download raw Binance Vision monthly and daily archives, verify cryptographic SHA-256 checksums, rebuild features from scratch, and independently compute all published metrics.
   - *Proves*: Full end-to-end source-to-number independence.

---

## 2. Trust Boundaries: What It Proves vs. What It Trusts

| Category | What Is Trusted | What Is Independently Proven |
|---|---|---|
| **Raw Data** | Binance Vision is trusted as the primary historical exchange source. | Every archive is validated against official Binance `.CHECKSUM` files and manifest SHA-256 hashes. |
| **Parsing** | None. Standard library CSV parser only. | Detects header rows, normalizes microsecond timestamps (`> 1e14`), resolves duplicates (`keep-last`), and chronologically sorts. |
| **Features** | None. Zero imported pipeline code. | Strictly enforces the exact 1-hour continuity rule for log returns ($\Delta t = 3,600,000\text{ ms}$), UTC calendar mapping, and taker buy ratios. |
| **Statistical Math** | None. Zero third-party dependencies (no pandas, numpy, scipy, or duckdb). | Recomputes sample standard deviations ($\div (N-1)$), population moments ($g_1, g_2$), nearest-rank quantiles, running drawdowns, and discrete compounding. |
| **Infrastructure** | None. Runs offline or locally. | Validates that published numbers strictly match independent math within documented tolerances. |

---

## 3. How to Run the Verification Kit

### Requirements
- **Python 3.12+**
- **Standard Library Only**: No external packages required (`pip install` is NOT needed).

### Basic Run
1. Navigate to the **Data Quality** tab in the web application and click **"Export Verification Manifest"** (or use `artifacts/current/verification_manifest.json`).
2. Run the verification kit:

```bash
python verification/verify_release.py --manifest verification_manifest.json
```

### CLI Arguments

| Flag | Default | Description |
|---|---|---|
| `--manifest` | *(Required)* | File path or URL to `verification_manifest.json`. |
| `--base-url` | `https://data.binance.vision` | Binance Vision archive URL override (e.g. for mirrors or offline CI testing). |
| `--cache-dir` | `.cache/verification` | Directory to cache downloaded `.zip` archives locally. |
| `--data-file` | `None` | Path to pre-merged CSV dataset to bypass archive downloads. |
| `--quiet` | `False` | Suppress informational progress output. |

### Running Offline or Behind Firewalls
If archives are already downloaded or mirrored locally:

```bash
python verification/verify_release.py \
  --manifest verification_manifest.json \
  --base-url file:///path/to/local/binance/mirror \
  --cache-dir /path/to/local/archive/cache
```

---

## 4. Output & Status Reporting

The script evaluates all definitions against independent calculations and prints a formatted verification report:

```
==========================================================================================
                  BTC HOURLY ANALYTICS — INDEPENDENT VERIFICATION REPORT                  
Release: 20261120T133443Z | Pipeline Commit: 66956982 | Dataset: 60,360 bars
==========================================================================================
STATUS   | METRIC DEFINITION ID           | MAX DELTA    | TOLERANCE    | DETAILS
------------------------------------------------------------------------------------------
PASS     | kpi.total_bars                 | 0.00e+00     | ±1.0e-09     | 
PASS     | kpi.latest_close               | 0.00e+00     | ±1.0e-09     | 
PASS     | kpi.period_return_pct          | 0.00e+00     | ±1.0e-09     | 
PASS     | kpi.max_drawdown               | 0.00e+00     | ±1.0e-09     | 
PASS     | kpi.best_hour                  | 7.11e-15     | ±1.0e-09     | Hour 21:00
PASS     | kpi.worst_hour                 | 7.99e-15     | ±1.0e-09     | Hour 23:00
PASS     | seasonality.mean_return        | 1.11e-14     | ±1.0e-09     | bucket=hour
PASS     | seasonality.volatility         | 1.56e-13     | ±1.0e-09     | bucket=hour
PASS     | calendar.monthly_returns       | 0.00e+00     | ±1.0e-09     | 
PASS     | calendar.ytd                   | 0.00e+00     | ±1.0e-09     | 
==========================================================================================
RESULTS: 46 PASSED, 0 FAILED out of 46 verified definitions.
==========================================================================================
```

- **Exit Code 0**: All definitions matched within tolerance.
- **Exit Code 1**: One or more definitions or checksums failed.
