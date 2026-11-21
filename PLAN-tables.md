# PLAN-tables.md — Client Validation Tables (replaces the SQL Playground)

Baseline: commit `560fd89` (verify-phase-c-fixes). This SUPERSEDES the client-facing surfaces of
PLAN-verify.md Phases B/C. Audience: a NON-technical client. The trust model shifts from
"independent SQL engine parity" to **enumerable instances + transparent live recompute + source
provenance** — which is what a client can actually use.

## 1. Mission
A dedicated **Validation** section that exposes EVERY existing KPI/chart as interactive Tabulator
tables. Every aggregate row is drillable to the exact raw bars behind it, with a plain-language
"recompute from these instances" proof and CSV/Excel export. ALL SQL/DuckDB/kit/manifest machinery
is removed. No new analytics are invented — tables render the EXISTING registry definitions.

## 2. Locked decisions
| # | Decision |
|---|---|
| 1 | Remove EVERYTHING SQL/kit: client DuckDB-WASM, Playground tab, SQL validator, badges, client parity, **CI parity gate**, **offline Python kit**, **manifest exporter**, duckdb deps (npm+pip), wasm assets, verification/ dir. |
| 2 | ONE dedicated "Validation" section (a single tab with a prominent domain switcher), not per-tab toggles. |
| 3 | Row/instance design = best fit for THIS project (not a copy of NSE): aggregate row = value + n + an "Instances" drill-down (hourly buckets hold ~2,500 bars → count + drill, not inline dates). |
| 4 | Drill-down = best fit: row click opens the simplified inspect drawer scoped to that row's instances. |
| 5 | Tabulator tables + a plain-language "show the math from these instances" proof panel (client-facing verification). |
| 6 | Series analytics (rolling vol, CVD, drawdown) = FULL paginated tables (~60k rows), each point drillable. |
| 7 | Export BOTH CSV and Excel (Excel via lazy-loaded SheetJS `xlsx`). |
| 8 | Keep simplified drawer (Definition/Inputs/Instances/Proof/Provenance, NO SQL); Tabulator.js (modular); a Raw Data table (all 60k OHLCV rows) lives in the Validation section. |

## 3. Phase R — Removal checklist (do FIRST, suites must stay green)
Delete:
- `web/src/verify/`: `engine.ts`, `badges.ts`, `parity.ts`, `sql_validator.ts`(+test), `manifest.ts`(+test), `parity.test.ts`.
- `web/src/ui/playground.ts`; Playground entry in `sidebar.ts`, `types.ts` (TabId), `main.ts` (PAGE_INFO + mount case).
- `web/scripts/copy-duckdb-assets.mjs` + its predev/prebuild hooks; `web/public/duckdb/` refs; any duckdb `manualChunks` in vite.config.
- `verification/` entirely (`parity_check.py`, `verify_release.py`, `fixtures/`, `README.md`); `pipeline/tests/test_verify_release.py`.
- CI: the setup-python + `pip install duckdb` + `parity_check.py` steps in `.github/workflows/ci.yml`; `duckdb` from `requirements-dev.txt`.
- `@duckdb/duckdb-wasm` from `web/package.json` (+lockfile).
- Manifest export button in `quality.ts`; all badge/parity/engine imports across `overview.ts`, `quality.ts`, charts, `drawer.ts`.
- `registry.ts`: remove the `sql()` builders (dead without parity). KEEP `tolerance` (used by the proof recompute match check).
Edit:
- `drawer.ts`: drop the SQL cross-check action/button + engine import → simplified drawer (§7).
- `README.md`: remove SQL/kit/manifest sections; document the Validation section.
- `DEVIATIONS.md`: record this removal decision (supersedes PLAN-verify B/C client surfaces).
KEEP (do not remove):
- `registry.ts` (minus sql), `links.ts`, simplified `drawer.ts`, registry-driven tooltips, ALL analytics functions.
- Pipeline provenance: `source_files` + `artifact_sha256` in meta.json (+ their tests) — they feed the drawer/Quality provenance.
Acceptance R: zero `duckdb`/`@duckdb`/`parity`/`manifest`/`playground` references remain (grep-provable);
pytest + vitest + eslint + tsc + build green; main bundle SHRINKS; app works minus Playground. Commit `validation-removal`.

## 4. Validation section architecture (Phase V1)
- New sidebar item **Validation** (single tab). Top: a domain switcher (segmented control):
  **KPIs · Seasonality · Heatmap · Volatility · Flow · Calendar · Raw Data · Quality**.
- The section is a GENERIC **registry → Tabulator renderer** keyed by def `kind`:
  scalar → one KPI row; grouped → one row per bucket; matrix → one row per cell; series → one row per point;
  provenance → quality rows. Tables render EXISTING registry defs (no new math, no drift).
- `web/src/validation/table.ts`: Tabulator factory (modular v6 imports: Sort, Filter, Page, Download, Format,
  Interaction). Local pagination (10/20/50/100), header filters, sorting, row-click → drill-down callback,
  CSV download + lazy Excel. Verify the exact Tabulator v6 module API at build time.
- The whole Validation module + Tabulator are **lazy-loaded** (dynamic import on first open) → initial app bundle unaffected.
- `web/src/validation/instances.ts`: per-def instance selector returning the exact `KlineRow[]` subset behind a row
  (bucket filter / cell filter / month filter / window / single bar). Pure, tested.

## 5. Per-domain table specs
Every aggregate table includes an **Instances** column (count + "view" affordance) and row-click drill-down.
- **KPIs**: rows = registry `kpi.*` scalars. Cols: KPI · Value(formatted) · n · Instances. (best/worst hour → bars at that hour; max_drawdown → peak/trough context; totals → Raw Data.)
- **Seasonality**: bucket switch (hour/dow). WIDE table, one row per bucket, ALL 6 metrics as cols: Bucket · Mean(bps) · Vol(bps) · Win% · Volume(BTC) · Taker ratio · Range(bps) · n · Instances.
- **Heatmap**: metric selector. Rows = 168 cells: Day · Hour · Value · n · Instances. Filterable by Day/Hour.
- **Volatility**: (a) Distribution stats table (mean/σ/skew/kurt/p1..p99, each with n + instances=the returns); (b) Histogram table (50 bins: range · count · % · instances); (c) Rolling-vol FULL series table (ts · window · σbps · n_valid · instance).
- **Flow**: (a) Hourly taker ratio (24 rows: Hour · Taker% · n · Instances); (b) CVD FULL series (ts · barΔ · cumulative · instance).
- **Calendar**: (a) Monthly returns (~82 rows: Year · Month · Open · Close · Return% · n · Instances); (b) YTD (Year · YTD% · months); (c) Drawdown FULL series (ts · close · peak · dd% · instance).
- **Raw Data**: ALL 60k rows, all 15 parquet columns, sort/filter/paginate/export; row click → single-bar drawer.
- **Quality**: Gaps table (start · end · hours); Per-year counts (year · rows · expected · coverage%); Provenance card/table (release_id · pipeline_git_sha · artifact_sha256 · source_files count · freshness).

## 6. Instance drill-down + plain-language proof (the trust core)
Row click → simplified drawer scoped to that row's instances:
1. **Definition** — formula/unit/conventions from registry.
2. **Inputs** — filter range, bucket/target, n total / n used / n excluded (gaps).
3. **Instances** — a Tabulator of the exact bars/returns behind the number (sortable, exportable).
4. **Proof panel** — plain language, e.g. *"This is the mean of 2,496 hourly returns from 2020-01-01 to 2026-11-19. Recomputed live from the instances below: +2.31 bps ✓ matches the displayed value."* A **Recompute from instances** button runs `registry.compute` over the subset and shows match within `tolerance`. NO SQL.
5. **Provenance** — release_id, sha, generated_at, source files.
6. **Actions** — Copy proof link · Export instances (CSV/Excel).

## 7. Exports
CSV via Tabulator download (native). Excel via **dynamic import of `xlsx`** on click only (pinned; lazy chunk).
Export respects active filters (what the client sees is what they get). Available on every table AND on instance subsets.

## 8. Proof links
Extend `links.ts`: `#/inspect?tab=validation&domain=…&bucket=…&target=…&metric=…&start=…&end=…&release_id=…`.
Restore → open Validation, set domain, open the row's drawer. Existing chart proof links keep working; release-mismatch notice retained.

## 9. Bundle / perf budgets
Initial app chunk: unchanged by Validation (lazy). Tabulator modular ≤ ~45 KB gz (lazy). `xlsx` ≤ ~150 KB gz, loaded ONLY on Excel click.
60k-row tables use local pagination (render page only). Instance subsets computed on drill from loaded rows. Record measured deltas in phase reports.

## 10. Testing
Vitest: instance selectors per domain (correct subset on fixtures incl. gaps/nulls); proof recompute equals row value; links round-trip with validation params; a removal-regression test asserting no duckdb/parity/manifest imports remain.
Data-logic tests over fixtures (no heavy DOM); Tabulator wiring smoke-tested via jsdom/happy-dom if available.
Acceptance is checkable by a NON-technical reviewer: open Validation → see tables → click a row → see instances + plain math → export CSV/Excel.

## 11. Phases & acceptance
**R — Removal** (§3): grep-clean, suites green, bundle shrinks. Commit `validation-removal`.
**V1 — Core**: Tabulator factory + Validation tab + domain switcher + instance drill-down + proof panel + CSV/Excel + proof links; domains **Raw Data, KPIs, Seasonality**. Acceptance: those three fully usable end-to-end; lazy-load proven; exports work. Commit `validation-core`.
**V2 — Complete**: domains **Heatmap, Volatility, Flow, Calendar, Quality** (incl. full series tables). Acceptance: all 8 domains usable; every aggregate row drillable; series paginated; reviewer checklist passes. Commit `validation-complete`.

## 12. Guardrails
- No new analytics — tables expose EXISTING registry defs only; proof uses registry.compute (no shadow math).
- After R: ZERO SQL/duckdb/kit/manifest anywhere (grep-provable, CI-enforced).
- Keep pipeline provenance fields; keep registry as single formula source.
- Heavy libs lazy; initial bundle must not grow.
- **Standing rule: check the CI run on your OWN pushed commit and report its conclusion before claiming a phase done.**
- Any departure → DEVIATIONS.md (what/why/alternative); ask only if truly blocked.