# BTCUSDT 1h Analytics Web App

An interactive price charting and honest statistical seasonality analytics platform over Binance USDⓈ-M futures `BTCUSDT` 1h klines (2020-01 → present, ~60k hourly bars).

> **Disclaimer**: This application is an educational, descriptive analytics tool. It is **NOT** a trading bot and **NOT** a signal service.

---

## 1. Architecture

```
Binance Vision (Monthly + Daily ZIPs)
               │ (Server-side daily ETL)
               ▼
   [ pipeline (Python 3.12) ]
   ├── ingest: downloads, SHA-256 checks, ms/µs normalization, header sniffing
   ├── dedupe & sort: drops duplicates (keeps last), strict chronological order
   ├── validate: price/volume bounds check, quarantines invalid rows
   ├── transform: per-row feature derivation (log_ret, hour, dow, taker ratio, hl_range)
   └── export: uncompressed Parquet + meta.json + quality_report.json
               │
               ▼ (Atomic symlink release swap: /data/current)
   [ web (Vite + TypeScript SPA) ]
   ├── hyparquet: zero-dependency in-browser parquet parser via HTTP range requests
   ├── TradingView Lightweight Charts v5: high-performance candlestick & volume pane
   └── Apache ECharts: interactive seasonality, heatmaps, flow, & distribution charts
```

- **No backend database, no runtime API, no auth**.
- **Browser NEVER calls Binance at runtime** — completely decoupled from exchange endpoints.
- **Atomic releases**: Server-side ETL produces versioned artifacts under `artifacts/releases/<release_id>/` and atomically updates `artifacts/current`.

---

## 2. Quickstart (Docker)

To build and run the complete stack (ETL initial run + cron daemon + web server):

```bash
docker compose up --build
```
*(or `docker-compose up --build`)*

Open **[http://localhost:8080](http://localhost:8080)** in your browser.

The `etl` container executes an initial ingestion run immediately on startup, writes validated artifacts to the shared volume, and starts a `supercronic` cron daemon that refreshes data daily at **03:30 UTC**. The `web` container serves the SPA and artifacts through Nginx with gzip compression, caching rules, and security headers.

---

## 3. Local Development

### Prerequisites
- Python 3.12+
- Node.js 20+ & npm

### Setup
```bash
# Set up Python virtual environment and web dependencies
make setup

# Run ETL pipeline locally to populate artifacts/
make data

# Run tests
make test

# Run linters
make lint

# Run web dev server
make dev
```

---

## 4. Analytical Features & Methodology

### Tab 1: Price
- **TradingView Lightweight Charts v5** rendering full 60k+ bar history with candlestick and volume histogram panes.
- **Logarithmic scale toggle** for long-term multi-cycle regime inspection.
- **Crosshair OHLCV tooltip** displaying exact bar values.
- **UTC ↔ IST display toggle**: Adds +19,800s (5h 30m) to display timestamps for Indian Standard Time viewers while leaving internal bucket alignments strictly in UTC.

### Tab 2: Seasonality
- **Hour of Day (0–23 UTC)** and **Day of Week (Mon–Sun UTC)** aggregations.
- **Metric Selector**:
  - *Mean Return*: In basis points ($1\text{ bps} = 0.01\%$).
  - *Volatility ($\sigma$)*: Standard deviation of hourly log returns in bps.
  - *Win Rate*: Share of hourly bars with positive return ($\log(c_t/c_{t-1}) > 0$).
  - *Total Volume*: Cumulative volume in BTC.
  - *Taker Buy Ratio*: Ratio of sums $\frac{\sum \text{taker\_buy\_volume}}{\sum \text{volume}}$.
  - *Mean H-L Range*: Normalized bar range $\frac{\text{high} - \text{low}}{\text{open}}$ in bps.
- **Trading Sessions Overlay**: Highlights typical major market operating hours in UTC:
  - *Asia*: 00:00 – 08:00 UTC
  - *Europe*: 07:00 – 16:00 UTC
  - *US*: 13:00 – 22:00 UTC

### Tab 3: Data Quality
- Transparent audit of the entire dataset.
- Real-time display of `meta.json` and `quality_report.json`:
  - Expected vs actual hours and coverage percentage.
  - Checksum validation records.
  - Exchange gap intervals (never fabricated or interpolated).
  - Detected file units (ms vs $\mu$s) and sniffer header results.
  - Annual bar observation counts and pipeline Git commit SHA.

### Tab 4: 7×24 Heatmap
- $7 \times 24$ (Day $\times$ Hour) matrix visualising cyclical tendencies across every hour of the trading week.
- Centered diverging color palette for directional returns.
- Sample size $n$ (~350–360 observations per cell) displayed in hover tooltips.

### Tab 5: Volatility & Distribution
- **Rolling Volatility**: Sliding window $\sigma$ (default 168 hours / 1 week, adjustable from 24h to 720h) revealing regime shifts.
- **Return Distribution**: 50-bin histogram of hourly returns.
- **Higher Moments & Quantiles**:
  - Sample mean and standard deviation.
  - Sample skewness ($m_3 / s^3$).
  - Excess kurtosis ($m_4 / s^4 - 3$), highlighting heavy fat-tail risks.
  - Percentiles: p1, p5, p25, p50 (median), p75, p95, p99.

### Tab 6: Order Flow
- **Hourly Taker Buy Ratio**: Aggressive taker volume balance by hour of day.
- **Cumulative Taker Delta**: Net aggressive order flow line:
  $$\text{Cumulative Delta} = \sum_{t=1}^T (2 \cdot \text{taker\_buy\_volume}_t - \text{volume}_t)$$

### Tab 7: Calendar & Risk
- **Year $\times$ Month Return Grid**: Monthly performance breakdown and YTD compounded returns.
- **Historical Underwater / Drawdown Chart**: Tracks peak-to-trough decline from high-water mark close prices:
  $$\text{Drawdown}_t = \frac{\text{close}_t - \max_{\tau \le t}(\text{close}_\tau)}{\max_{\tau \le t}(\text{close}_\tau)} \times 100\%$$

---

## 5. Statistical Rules & Honest Caveats

1. **Returns, Never Price Levels**: All cyclical metrics aggregate log returns:
   $$r_t = \ln\left(\frac{\text{close}_t}{\text{close}_{t-1}}\right)$$
   Aggregating price levels across trending assets creates spurious artifacts.
2. **Strict Gap Handling**: If consecutive bars are separated by more than 3,600,000 ms (exchange maintenance or outage), $r_t$ is recorded as `null` and excluded from return metrics. Gaps are never zero-filled or interpolated.
3. **Weak and Non-Stationary Effects**: Historical calendar effects in crypto are weak, time-varying, and often reverse across macro market regimes.
4. **Frictions Exceed Anomalies**: Most hourly seasonality anomalies are less than 5–10 bps, which is smaller than typical round-trip taker fees and execution slippage.
5. **Multiple Testing Risk**: Evaluating 168 cells in a $7 \times 24$ grid inevitably yields several false positives at standard $\alpha = 0.05$ significance thresholds purely by chance.

---

## 6. Testing

All automated tests use self-contained synthetic fixtures and require **no network connection**:

```bash
# Python pipeline tests (45 tests)
.venv/Scripts/pytest pipeline/tests/ -v

# Web unit tests (26 tests)
cd web && npm test -- --run
```
