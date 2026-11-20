# PLAN-verify.md — Verification Playground ("Every Number Shows Its Work")

Source of truth for the implementing agent. Extends the existing app (commit baseline: `audit-fixes`).
§2 decisions are LOCKED. Existing analytics semantics must NOT change — this feature verifies them.

## 1. Mission
Let any viewer audit any displayed number in three clicks, at three levels of independence:
1. **Explain** — inspect drawer: formula, exact inputs, computation trace, underlying rows, CSV export, provenance.
2. **Cross-check** — DuckDB-WASM runs equivalent SQL over the same Parquet; app value vs SQL value, ✓/✗ + Δ.
3. **External kit** — downloadable stdlib-only Python script that re-downloads Binance sources, verifies
   checksums, rebuilds features independently, recomputes every published KPI, prints PASS/FAIL.
Honest labeling everywhere: recompute-with-same-code proves *wiring*; SQL parity proves *implementation*;
the kit proves *source-to-number independence*. Never overclaim.

## 2. Locked decisions
| Decision | Choice |
|---|---|
| Audience | Public-ready (portfolio + clients) |
| Keystone | Single **definition registry**; tooltips, drawers, SQL, manifest all render from it |
| Registry math | MUST delegate to existing tested functions (aggregations.ts / analytics.ts / display.ts). No reimplementation. |
| DuckDB | `@duckdb/duckdb-wasm`, **non-threaded EH bundle**, self-hosted in `web/public/duckdb/` (zero runtime external requests). NO COOP/COEP headers. Lazy-loaded only on first verify/Playground use. |
| SQL console | Editable, catalog of registry queries, **read-only allowlist** (statement must start with SELECT/WITH after comment strip; reject ATTACH/COPY/INSTALL/LOAD/PRAGMA/SET/CREATE/DROP/INSERT/UPDATE/DELETE/ALTER/EXPORT/IMPORT). No httpfs. Results capped at 500 rows shown. |
| Kit | Python 3.12, **stdlib only**, `verification/verify_release.py`, `--base-url` override for offline/CI |
| Manifest | Generated **client-side** from the registry (it is the app's *claim*; independence lives in the kit) |
| Phases | A → B → C, each independently shippable, commit per phase |
| New deps | Phase A: none. Phase B: `@duckdb/duckdb-wasm` (pinned) + `duckdb` (Python, CI only, pinned in requirements-dev). Phase C: none. |

## 3. Definition registry (Phase A keystone)
`web/src/verify/registry.ts`:
```ts
type Kind = 'scalar' | 'grouped' | 'matrix' | 'series' | 'provenance';
interface MetricDef {
  id: string;                    // e.g. 'seasonality.mean_return.hour', 'kpi.max_drawdown'
  kind: Kind;
  label: string; unit: string;   // bps | % | BTC | ratio | count | USD
  formula: string;               // human-readable; THE source for tooltips + drawer
  conventions: string[];         // e.g. ['UTC buckets','null log_ret excluded','sample σ ÷(N−1)','open→close']
  paramsSchema: {...};           // startMs, endMs, metric?, bucket?, window? — numeric/enum only, validated
  compute(rows, p): Result;      // wraps existing fns; Result includes value(s), n, and trace intermediates
  sql?(p): string;               // Phase B; numeric literals only (validated params, no string interpolation of free text)
  tolerance: { rel: number; abs: number };  // default {rel:1e-9, abs:1e-9}
  format(v): string;             // reuse display.ts
}
```
Result shapes: scalar {value,n,trace}; grouped/matrix {keys:[{key,value,n}],trace}; series {points,summary:{n,min,max,mean}};
provenance {report fields + source links, no SQL}.

**Inventory to register (wrap, don't rewrite):**
- Overview KPIs: total_bars, span_years, latest_close, period_return_pct, max_drawdown, best/worst hour,
  best/worst dow, hourly_win_rate, mean_hourly_return, per_year_counts, coverage_pct (kind:'provenance').
- Seasonality: 6 metrics × bucket∈{hour,dow} (parameterized defs).
- Heatmap: 6 metrics × (dow×hour) matrix.
- Volatility: rolling_vol series (window param); distribution mean/σ/skew_g1/kurt_g2; 7 quantiles;
  histogram → **summary-only parity** (n,min,max; bins are visual, conventions documented).
- Flow: cvd series + net_total; hourly taker ratio (reuse seasonality def, % format).
- Calendar: monthly_returns matrix (open→close), ytd per year (Π(1+r)−1), drawdown series + max.
- Quality rows: kind:'provenance' (checksums/gaps/freshness — verified by kit, not SQL; label honestly).

**Replace all hardcoded tooltip formula strings** in charts/ui with registry lookups (kills the F4/F5/F6 drift class).
Vitest: snapshot test per def (formula/conventions non-empty, compute delegates correctly on fixtures, params validation).

## 4. Inspect drawer (Phase A)
`web/src/verify/drawer.ts`. Triggers: inspect icon on every KPI card and chart-card header; click on heatmap cell,
seasonality bar, calendar month cell; inspect on Quality rows. Right-side panel (full-screen mobile), Escape/outside
close, focus trap, aria, theme tokens. Sections:
1. **Definition** — formula, unit, conventions (from registry).
2. **Inputs** — filter echo (ISO range, metric, bucket, window), rows in range, n used, n excluded (gaps).
3. **Trace** — intermediates (Σr, Σr², Σvol, Σtaker, per-bucket n) computed on open.
4. **Data** — first 5 + last 5 rows of the exact subset; **Download subset CSV** (all 15 columns, RFC4180,
   nulls empty, ordered by open_time_ms, deterministic filename `<id>_<start>_<end>.csv`).
5. **Provenance** — release_id, pipeline_git_sha, generated_at, source-file URLs covering the range.
6. **Actions** — Recompute live (label: "wiring check, same code"); Cross-check SQL (Phase B); Copy proof link.
**Proof links**: hash params `#/inspect?tab=…&metric=…&bucket=…&start=…&end=…&target=…` restore tab+filter+drawer on
load; no params → unchanged app. `verify/links.ts` + tests.
Budget: main bundle growth ≤ ~30 KB gz; zero new deps in Phase A.

## 5. DuckDB cross-check + Playground (Phase B)
- **Assets**: `web/scripts/copy-duckdb-assets.mjs` (npm predev/prebuild) copies the EH wasm + worker from node_modules
  into `web/public/duckdb/`. nginx: ensure `application/wasm` mime; gzip allowed for wasm; parquet stays uncompressed
  with native ranges; **do not add COOP/COEP or CSP** in this scope.
- **Engine** `verify/engine.ts`: singleton lazy init; fetch `/data/current/btcusdt_1h.parquet` (no-cache) →
  `registerFileBuffer('klines.parquet', bytes)` → `CREATE VIEW klines AS SELECT * FROM parquet_scan('klines.parquet')`.
  Record meta.release_id at init; if it differs from current meta on a later verify, re-init. 10 s query guard
  (terminate worker + re-init on timeout). Errors surfaced verbatim.
- **Parity runner**: run def.sql(p), compare to def.compute per tolerance; grouped/matrix per-key; series per-point;
  report matched/total + max Δ. Badges (`verify/badges.ts`): unchecked(gray)/match(green)/mismatch(amber)/error,
  keyed by defId+paramsHash, in-memory. "Verify visible" button per tab runs all with progress.
- **SQL semantics MUST match TS conventions** (these prevent false mismatches):
  - Use stored `hour`/`dow` columns (never recompute dow — DuckDB dow() is 0=Sunday).
  - Range filter: `open_time_ms BETWEEN {start} AND {end}` (inclusive, matches filterByRange).
  - Returns: AVG/STDDEV_SAMP over `log_ret` (NULLs auto-excluded = TS filter). σ: **STDDEV_SAMP**, wrap
    `COALESCE(...,0)` (TS returns 0 when <2 valid). win_rate: AVG(CASE WHEN log_ret>0 THEN 1.0 ELSE 0 END) with
    `log_ret IS NOT NULL`. taker: `COALESCE(SUM(taker_buy_volume)/NULLIF(SUM(volume),0),0)`.
  - Quantiles (TS nearest-rank): `rn = LEAST(CAST(floor(p*cnt) AS BIGINT)+1, cnt)` over row_number-sorted returns.
  - g1/g2: population moments via CTE: m2,m3,m4 = AVG(POWER(x−mu,k)); g1=m3/POWER(m2,1.5); g2=m4/(m2*m2)−3.
  - Rolling vol: `STDDEV_SAMP(log_ret) OVER (ORDER BY open_time_ms ROWS BETWEEN {W−1} PRECEDING AND CURRENT ROW)`,
    emit rows with row_number ≥ W, COALESCE→0, ×10000.
  - Monthly: `arg_min(open, open_time_ms)`, `arg_max(close, open_time_ms)` grouped by
    `year(epoch_ms(open_time_ms)), month(epoch_ms(open_time_ms))`. YTD: product of (1+r/100) per year.
  - Drawdown: `MAX(close) OVER (ORDER BY open_time_ms ROWS UNBOUNDED PRECEDING)`.
    CVD: `SUM(2*taker_buy_volume − volume) OVER (…UNBOUNDED PRECEDING)`.
  - Histogram: summary-only parity (document why).
- **Playground tab** (9th, `tab:'playground'`, label "Playground"): catalog dropdown (registry SQL pre-filled with
  current filters), plain monospace textarea editor (Ctrl+Enter run), result grid (≤500 rows + truncation note),
  runtime/rowcount, DESCRIBE-klines schema panel, "Compare with app" panel for catalog items, honest caption.
- **CI parity (no browser needed)**: `web/src/verify/parity.test.ts` (vitest) builds deterministic synthetic rows
  (~2,000, with gaps/zero-volume/nulls), computes expected via registry, and writes
  `verification/fixtures/parity_cases.json` [{id, params, sql, expected, tolerance}] + `fixture.parquet`
  (write via a small node script using the same synthetic rows; or generate parquet in the Python step from CSV —
  agent's choice, document it). `verification/parity_check.py` (pip `duckdb`, pinned) loads cases, runs each SQL
  against the fixture, asserts within tolerance. New CI job runs vitest → parity_check. This tests the trust feature itself.

## 6. Manifest + external kit (Phase C)
- **Pipeline (small)**: ingest records `source_files:[{url, sha256, kind}]` into stats → meta.json; export adds
  `artifact_sha256` (sha256 of the parquet). Tests for both.
- **Manifest export** (Quality tab button): `verification_manifest.json` = {release_id, artifact_sha256,
  generated_at, pipeline_git_sha, scope:{start,end}, definitions:[{id, params, formula, conventions, tolerance,
  expected}]} where expected = scalar value+n; grouped/matrix full keyed values+n; series summary {n,min,max,mean}.
  artifact_sha256 computed in-browser via crypto.subtle over the fetched parquet bytes.
- **Kit** `verification/verify_release.py` (stdlib only, ~350–450 lines, readable — it is the trust artifact):
  1. Load manifest; 2. enumerate+download monthly/daily zips for scope from `--base-url` (default
  data.binance.vision; same 404-fallback rules, implemented independently); 3. verify each zip against Binance's
  `.CHECKSUM` **and** manifest sha; 4. own parser (header sniff, >1e14→µs), dedupe keep-last, sort;
  5. own feature math (log_ret with exact-1h rule, hour, dow via weekday(), taker ratio, hl_range);
  6. recompute every definition independently (rolling σ via running Σx/Σx² — document method; same sample-σ
  definition); 7. compare per tolerance; 8. print PASS/FAIL table, exit non-zero on any FAIL.
  Flags: `--manifest`, `--base-url`, `--cache-dir`, `--quiet`. Full live run target < ~2 min.
- **Kit CI**: pytest builds a tiny fixture release tree (zips+CHECKSUMs+manifest) and runs the kit end-to-end with
  `--base-url file://…` (or local http.server) — fully offline. Agent also runs the kit once against the live
  release and reports the table.
- **Docs**: `verification/README.md` (how to run, what it proves / doesn't — trusts Binance as source; conventions),
  linked from Quality tab + main README.

## 7. Guardrails
- Do NOT change existing analytics behavior. If parity exposes a genuine bug in an existing function: STOP that
  sub-task, document evidence in DEVIATIONS.md, fix only with a test proving the bug, flag in the phase report.
- Zero runtime external requests (wasm self-hosted; kit downloads only from Binance/`--base-url`).
- No COOP/COEP, no CSP changes, no new analytics, no chart builder, no server-side code beyond §6 pipeline additions.
- Registry is the single source of formula truth; any new copy string must come from it.
- Log everything that departs from this plan in DEVIATIONS.md; ask only if truly blocked.

## 8. Phases & acceptance
**A — Registry + drawers + proof links.** Accept: every KPI card/chart/cell/row inspectable; tooltips render from
registry; CSV deterministic; proof links restore state; registry snapshot tests green; bundle ≤ +30 KB gz; no new deps.
**B — DuckDB parity + badges + Playground.** Accept: CI parity job green for ALL defs on fixtures; badges + verify-
visible work; console rejects non-allowlisted statements (tests); network tab shows no duckdb assets until first use;
engine re-inits on release change; fresh-volume compose still healthy.
**C — Manifest + kit + docs.** Accept: manifest artifact_sha256 equals `sha256sum` of served parquet; kit PASSes the
offline fixture release in CI; kit PASSes live release (report included); docs complete.
Definition of done per phase: acceptance met, full pytest+vitest+lint+tsc green, DEVIATIONS updated, commit
(`verify-phase-a` / `-b` / `-c`), short status report (passed checks, deviations, open questions).