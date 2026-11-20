/**
 * Definition Registry for Verification Playground.
 * Keystone of the verification system (Phase A).
 *
 * Rules:
 * - Single typed source of truth for tooltips, drawers, SQL, and manifest.
 * - Computations MUST wrap existing tested functions in aggregations.ts, analytics.ts, and display.ts.
 * - Never reimplement statistical math.
 */

import type { KlineRow, Meta, QualityReport, SeasonalityMetric } from '../types';
import {
  computeSeasonality,
  DOW_LABELS,
  getLogReturns,
  mean,
} from '../stats/aggregations';
import {
  computeCumulativeTakerDelta,
  computeDistributionStats,
  computeDrawdownSeries,
  computeHeatmap,
  computeMonthlyReturns,
  computeRollingVolatility,
} from '../stats/analytics';
import { formatSignedBps } from '../stats/display';

export type Kind = 'scalar' | 'grouped' | 'matrix' | 'series' | 'provenance';

export interface ParamSchema {
  type: 'number' | 'string' | 'boolean' | 'enum';
  enum?: string[];
  required?: boolean;
  default?: any;
  description?: string;
}

export interface ScalarResult {
  kind: 'scalar';
  value: number | string | null;
  n: number;
  trace: Record<string, any>;
}

export interface GroupedResultKey {
  key: string | number;
  label?: string;
  value: number | string | null;
  n: number;
}

export interface GroupedResult {
  kind: 'grouped';
  keys: GroupedResultKey[];
  trace: Record<string, any>;
}

export interface MatrixResultCell {
  key: string;
  label?: string;
  value: number | string | null;
  n: number;
  [extra: string]: any;
}

export interface MatrixResult {
  kind: 'matrix';
  keys: MatrixResultCell[];
  trace: Record<string, any>;
}

export interface SeriesPoint {
  timeMs: number;
  value: number;
  [extra: string]: any;
}

export interface SeriesResult {
  kind: 'series';
  points: SeriesPoint[];
  summary: { n: number; min: number; max: number; mean: number };
  trace: Record<string, any>;
}

export interface ProvenanceSource {
  name: string;
  url?: string;
  sha256?: string;
  kind?: string;
}

export interface ProvenanceResult {
  kind: 'provenance';
  report: Record<string, any>;
  sources: ProvenanceSource[];
  trace: Record<string, any>;
}

export type Result =
  | ScalarResult
  | GroupedResult
  | MatrixResult
  | SeriesResult
  | ProvenanceResult;

export interface MetricDef {
  id: string;
  kind: Kind;
  label: string;
  unit: string; // bps | % | BTC | ratio | count | USD | years
  formula: string;
  conventions: string[];
  paramsSchema: Record<string, ParamSchema>;
  compute(
    rows: KlineRow[],
    params?: Record<string, any>,
    context?: { meta?: Meta | null; qualityData?: QualityReport | null }
  ): Result;
  sql?(params: Record<string, any>): string; // Phase B
  tolerance: { rel: number; abs: number };
  format(val: any): string;
}

const DEFAULT_TOLERANCE = { rel: 1e-9, abs: 1e-9 };

// Helper formatters
function formatPct(v: any): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '—';
  return `${Number(v).toFixed(2)}%`;
}

function formatBps(v: any): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '—';
  return `${Number(v).toFixed(2)} bps`;
}

function formatCount(v: any): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '0';
  return Number(v).toLocaleString('en-US');
}

function formatUSD(v: any): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '$0';
  return `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function formatRatio(v: any): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '—';
  return Number(v).toFixed(4);
}

function formatBtc(v: any): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '0 BTC';
  return `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} BTC`;
}

export const METRIC_REGISTRY = new Map<string, MetricDef>();

export function registerMetricDef(def: MetricDef): void {
  METRIC_REGISTRY.set(def.id, def);
}

export function getMetricDef(id: string): MetricDef | undefined {
  if (METRIC_REGISTRY.has(id)) {
    return METRIC_REGISTRY.get(id);
  }
  // Try matching compound id e.g. "seasonality.mean_return.hour" -> "seasonality.mean_return"
  const lastDot = id.lastIndexOf('.');
  if (lastDot > 0) {
    const baseId = id.substring(0, lastDot);
    const suffix = id.substring(lastDot + 1);
    if (METRIC_REGISTRY.has(baseId) && (suffix === 'hour' || suffix === 'dow')) {
      return METRIC_REGISTRY.get(baseId);
    }
  }
  return undefined;
}

export function getAllMetricDefs(): MetricDef[] {
  return Array.from(METRIC_REGISTRY.values());
}

// ==========================================
// 1. Overview KPIs
// ==========================================

registerMetricDef({
  id: 'kpi.total_bars',
  kind: 'scalar',
  label: 'Dataset Bars',
  unit: 'count',
  formula: 'N = Total Hourly Observations',
  conventions: ['UTC discrete hours', 'null log_ret preserved (never dropped or interpolated)'],
  paramsSchema: {
    startMs: { type: 'number', description: 'Range start timestamp' },
    endMs: { type: 'number', description: 'Range end timestamp' },
  },
  compute: (rows) => ({
    kind: 'scalar',
    value: rows.length,
    n: rows.length,
    trace: { total_count: rows.length },
  }),
  tolerance: DEFAULT_TOLERANCE,
  format: formatCount,
});

registerMetricDef({
  id: 'kpi.span_years',
  kind: 'scalar',
  label: 'Chronological Scope',
  unit: 'years',
  formula: 'Δt = (t_latest − t_first) / (86,400,000 × 365.25)',
  conventions: ['Julian leap calendar year constant: 365.25 days', 'epoch ms timestamps'],
  paramsSchema: {
    startMs: { type: 'number' },
    endMs: { type: 'number' },
  },
  compute: (rows) => {
    if (rows.length < 2) return { kind: 'scalar', value: 0, n: rows.length, trace: { span_days: 0 } };
    const firstMs = rows[0].open_time_ms;
    const lastMs = rows[rows.length - 1].open_time_ms;
    const years = (lastMs - firstMs) / (86400000 * 365.25);
    return {
      kind: 'scalar',
      value: years,
      n: rows.length,
      trace: { first_ms: firstMs, last_ms: lastMs, span_ms: lastMs - firstMs, span_years: years },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: (v) => `${Number(v).toFixed(1)} years`,
});

registerMetricDef({
  id: 'kpi.coverage_pct',
  kind: 'provenance',
  label: 'Hourly Data Coverage',
  unit: '%',
  formula: 'Coverage = (Actual Bars / Expected Astronomical Hours) × 100%',
  conventions: [
    'Expected = 8,760h (standard year) / 8,784h (leap year)',
    'Missing hours correspond strictly to documented Binance maintenance windows',
  ],
  paramsSchema: {},
  compute: (rows, _p, ctx) => {
    const cov = ctx?.qualityData?.coverage_pct ?? 100;
    const actual = ctx?.qualityData?.actual_rows ?? rows.length;
    const exp = ctx?.qualityData?.expected_hours ?? rows.length;
    return {
      kind: 'provenance',
      report: {
        coverage_pct: cov,
        actual_rows: actual,
        expected_hours: exp,
      },
      sources: [{ name: 'Binance USDⓈ-M Public Vision Archives', url: 'https://data.binance.vision/' }],
      trace: { coverage_pct: cov, actual_rows: actual, expected_hours: exp },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatPct,
});

registerMetricDef({
  id: 'kpi.latest_close',
  kind: 'scalar',
  label: 'Latest Price',
  unit: 'USD',
  formula: 'P_latest = close of final kline in range',
  conventions: ['Nominal USDT settlement price', 'UTC ordered'],
  paramsSchema: {
    startMs: { type: 'number' },
    endMs: { type: 'number' },
  },
  compute: (rows) => {
    if (rows.length === 0) return { kind: 'scalar', value: 0, n: 0, trace: {} };
    const last = rows[rows.length - 1];
    return {
      kind: 'scalar',
      value: last.close,
      n: rows.length,
      trace: { open_time_ms: last.open_time_ms, close_price: last.close },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatUSD,
});

registerMetricDef({
  id: 'kpi.period_return_pct',
  kind: 'scalar',
  label: 'Period Total Return',
  unit: '%',
  formula: 'Total Return = ((P_close − P_open) / P_open) × 100%',
  conventions: ['P_open = open price of first bar in range', 'P_close = close price of last bar in range'],
  paramsSchema: {
    startMs: { type: 'number' },
    endMs: { type: 'number' },
  },
  compute: (rows) => {
    if (rows.length === 0) return { kind: 'scalar', value: 0, n: 0, trace: {} };
    const first = rows[0];
    const last = rows[rows.length - 1];
    const retPct = ((last.close - first.open) / first.open) * 100;
    return {
      kind: 'scalar',
      value: retPct,
      n: rows.length,
      trace: {
        first_open: first.open,
        last_close: last.close,
        price_delta: last.close - first.open,
        return_pct: retPct,
      },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: (v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`,
});

registerMetricDef({
  id: 'kpi.max_drawdown',
  kind: 'scalar',
  label: 'Maximum Drawdown',
  unit: '%',
  formula: 'MDD = min_t ( (Close_t − HighWaterMark_t) / HighWaterMark_t ) × 100%',
  conventions: ['HighWaterMark_t = max_{i ≤ t} Close_i', 'Hourly closes only (sub-hourly wicks not captured)'],
  paramsSchema: {
    startMs: { type: 'number' },
    endMs: { type: 'number' },
  },
  compute: (rows) => {
    const { maxDrawdownPct, series } = computeDrawdownSeries(rows);
    let minPoint = series[0];
    for (const pt of series) {
      if (pt.drawdownPct < (minPoint?.drawdownPct ?? 0)) {
        minPoint = pt;
      }
    }
    return {
      kind: 'scalar',
      value: maxDrawdownPct,
      n: rows.length,
      trace: {
        max_drawdown_pct: maxDrawdownPct,
        trough_time_ms: minPoint?.timeMs,
        trough_close: minPoint?.close,
        peak_at_trough: minPoint?.peak,
      },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatPct,
});

registerMetricDef({
  id: 'kpi.best_hour',
  kind: 'scalar',
  label: 'Best Hour (Mean Return)',
  unit: 'bps',
  formula: 'argmax_h ( (1 / N_h) × Σ_{t ∈ h} log_ret_t × 10,000 )',
  conventions: ['UTC hourly buckets 00:00–23:00', 'null log_ret excluded', 'returns in basis points'],
  paramsSchema: {},
  compute: (rows) => {
    const stats = computeSeasonality(rows, 'hour', 'mean_return');
    let best = stats[0] ?? { bucket: 0, value: 0, n: 0 };
    for (const s of stats) {
      if (s.value > best.value) best = s;
    }
    return {
      kind: 'scalar',
      value: best.value,
      n: best.n,
      trace: { best_hour: best.bucket, mean_return_bps: best.value, count: best.n },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatSignedBps,
});

registerMetricDef({
  id: 'kpi.worst_hour',
  kind: 'scalar',
  label: 'Worst Hour (Mean Return)',
  unit: 'bps',
  formula: 'argmin_h ( (1 / N_h) × Σ_{t ∈ h} log_ret_t × 10,000 )',
  conventions: ['UTC hourly buckets 00:00–23:00', 'null log_ret excluded', 'returns in basis points'],
  paramsSchema: {},
  compute: (rows) => {
    const stats = computeSeasonality(rows, 'hour', 'mean_return');
    let worst = stats[0] ?? { bucket: 0, value: 0, n: 0 };
    for (const s of stats) {
      if (s.value < worst.value) worst = s;
    }
    return {
      kind: 'scalar',
      value: worst.value,
      n: worst.n,
      trace: { worst_hour: worst.bucket, mean_return_bps: worst.value, count: worst.n },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatSignedBps,
});

registerMetricDef({
  id: 'kpi.best_dow',
  kind: 'scalar',
  label: 'Best Day of Week',
  unit: 'bps',
  formula: 'argmax_d ( (1 / N_d) × Σ_{t ∈ d} log_ret_t × 10,000 )',
  conventions: ['Mon=0, Tue=1, ..., Sun=6', 'null log_ret excluded', 'returns in basis points'],
  paramsSchema: {},
  compute: (rows) => {
    const stats = computeSeasonality(rows, 'dow', 'mean_return');
    let best = stats[0] ?? { bucket: 0, value: 0, n: 0 };
    for (const s of stats) {
      if (s.value > best.value) best = s;
    }
    return {
      kind: 'scalar',
      value: best.value,
      n: best.n,
      trace: { best_dow: best.bucket, day_label: DOW_LABELS[best.bucket], mean_return_bps: best.value, count: best.n },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatSignedBps,
});

registerMetricDef({
  id: 'kpi.worst_dow',
  kind: 'scalar',
  label: 'Worst Day of Week',
  unit: 'bps',
  formula: 'argmin_d ( (1 / N_d) × Σ_{t ∈ d} log_ret_t × 10,000 )',
  conventions: ['Mon=0, Tue=1, ..., Sun=6', 'null log_ret excluded', 'returns in basis points'],
  paramsSchema: {},
  compute: (rows) => {
    const stats = computeSeasonality(rows, 'dow', 'mean_return');
    let worst = stats[0] ?? { bucket: 0, value: 0, n: 0 };
    for (const s of stats) {
      if (s.value < worst.value) worst = s;
    }
    return {
      kind: 'scalar',
      value: worst.value,
      n: worst.n,
      trace: { worst_dow: worst.bucket, day_label: DOW_LABELS[worst.bucket], mean_return_bps: worst.value, count: worst.n },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatSignedBps,
});

registerMetricDef({
  id: 'kpi.hourly_win_rate',
  kind: 'scalar',
  label: 'Hourly Win Rate',
  unit: '%',
  formula: 'Win Rate = (N(log_ret > 0) / N_valid) × 100%',
  conventions: ['null log_ret excluded from denominator', 'strictly positive return count'],
  paramsSchema: {},
  compute: (rows) => {
    const rets = getLogReturns(rows);
    if (rets.length === 0) return { kind: 'scalar', value: 0, n: 0, trace: { win_count: 0, total_valid: 0 } };
    const wins = rets.filter((r) => r > 0).length;
    const wr = (wins / rets.length) * 100;
    return {
      kind: 'scalar',
      value: wr,
      n: rets.length,
      trace: { win_count: wins, loss_count: rets.length - wins, total_valid: rets.length, win_rate: wr },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatPct,
});

registerMetricDef({
  id: 'kpi.mean_hourly_return',
  kind: 'scalar',
  label: 'Mean Hourly Return',
  unit: 'bps',
  formula: 'Mean Return = (1 / N_valid) × Σ log_ret × 10,000 bps',
  conventions: ['null log_ret excluded', 'basis points (bps = return × 10,000)'],
  paramsSchema: {},
  compute: (rows) => {
    const rets = getLogReturns(rows);
    if (rets.length === 0) return { kind: 'scalar', value: 0, n: 0, trace: { sum_ret: 0 } };
    const sum = rets.reduce((a, b) => a + b, 0);
    const meanVal = (sum / rets.length) * 10000;
    return {
      kind: 'scalar',
      value: meanVal,
      n: rets.length,
      trace: { sum_log_ret: sum, valid_bars: rets.length, mean_bps: meanVal },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatSignedBps,
});

registerMetricDef({
  id: 'kpi.per_year_counts',
  kind: 'grouped',
  label: 'Annual Observation Counts',
  unit: 'count',
  formula: 'N_y = Count of hourly bars in year y (UTC)',
  conventions: ['UTC calendar years', 'Expected 8,760h (8,784h leap)'],
  paramsSchema: {},
  compute: (rows) => {
    const yearCounts: Record<number, number> = {};
    for (const r of rows) {
      const y = new Date(r.open_time_ms).getUTCFullYear();
      yearCounts[y] = (yearCounts[y] || 0) + 1;
    }
    const years = Object.keys(yearCounts).map(Number).sort((a, b) => a - b);
    const keys: GroupedResultKey[] = years.map((y) => ({
      key: y,
      label: String(y),
      value: yearCounts[y],
      n: yearCounts[y],
    }));
    return {
      kind: 'grouped',
      keys,
      trace: { year_counts: yearCounts },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatCount,
});

// ==========================================
// 2. Seasonality (6 metrics × {hour, dow})
// ==========================================

const SEASONALITY_METRICS: Array<{
  metric: SeasonalityMetric;
  label: string;
  unit: string;
  formulaTpl: (b: string) => string;
  conventions: string[];
  format: (v: any) => string;
}> = [
  {
    metric: 'mean_return',
    label: 'Mean Return',
    unit: 'bps',
    formulaTpl: (b) => `Mean Return_${b} = (1 / N_${b}) × Σ_{t ∈ ${b}} log_ret_t × 10,000`,
    conventions: ['UTC discrete buckets', 'null log_ret excluded', 'basis points'],
    format: formatSignedBps,
  },
  {
    metric: 'volatility',
    label: 'Volatility (σ)',
    unit: 'bps',
    formulaTpl: (b) => `σ_${b} = √[ 1 / (N_${b} − 1) × Σ_{t ∈ ${b}} (r_t − r̄_${b})² ] × 10,000`,
    conventions: ['Sample standard deviation ÷(N−1)', 'null log_ret excluded', 'returns 0 for N < 2'],
    format: formatBps,
  },
  {
    metric: 'win_rate',
    label: 'Win Rate',
    unit: '%',
    formulaTpl: (b) => `Win Rate_${b} = ( N(log_ret > 0)_{${b}} / N_valid_{${b}} ) × 100%`,
    conventions: ['null log_ret excluded', 'strictly positive return fraction'],
    format: formatPct,
  },
  {
    metric: 'total_volume',
    label: 'Total Volume',
    unit: 'BTC',
    formulaTpl: (b) => `Total Volume_${b} = Σ_{t ∈ ${b}} volume_t`,
    conventions: ['Aggregated base asset volume in BTC', 'all bars in bucket summed'],
    format: formatBtc,
  },
  {
    metric: 'taker_buy_ratio',
    label: 'Taker Buy Ratio',
    unit: 'ratio',
    formulaTpl: (b) => `TBR_${b} = Σ_{t ∈ ${b}} taker_buy_volume_t / Σ_{t ∈ ${b}} volume_t`,
    conventions: ['Ratio of sums (not mean of ratios)', '>0.50 denotes net aggressive buyer flow'],
    format: formatRatio,
  },
  {
    metric: 'mean_hl_range',
    label: 'Mean H-L Range',
    unit: 'bps',
    formulaTpl: (b) => `Mean Range_${b} = (1 / N_${b}) × Σ_{t ∈ ${b}} hl_range_t × 10,000`,
    conventions: ['hl_range = (high − low) / open', 'basis points'],
    format: formatBps,
  },
];

for (const sm of SEASONALITY_METRICS) {
  registerMetricDef({
    id: `seasonality.${sm.metric}`,
    kind: 'grouped',
    label: `Seasonality: ${sm.label}`,
    unit: sm.unit,
    formula: sm.formulaTpl('bucket'),
    conventions: sm.conventions,
    paramsSchema: {
      bucket: {
        type: 'enum',
        enum: ['hour', 'dow'],
        default: 'hour',
        description: 'Bucket partition: hour (0-23 UTC) or dow (0-6 Mon-Sun)',
      },
      startMs: { type: 'number' },
      endMs: { type: 'number' },
    },
    compute: (rows, params) => {
      const bucket = (params?.bucket === 'dow' ? 'dow' : 'hour') as 'hour' | 'dow';
      const results = computeSeasonality(rows, bucket, sm.metric);
      const keys: GroupedResultKey[] = results.map((r) => ({
        key: r.bucket,
        label: bucket === 'dow' ? DOW_LABELS[r.bucket] : `${String(r.bucket).padStart(2, '0')}:00 UTC`,
        value: r.value,
        n: r.n,
      }));
      return {
        kind: 'grouped',
        keys,
        trace: { bucket, metric: sm.metric, bucket_count: results.length },
      };
    },
    tolerance: DEFAULT_TOLERANCE,
    format: sm.format,
  });
}

// ==========================================
// 3. Heatmap (6 metrics × 7×24 matrix)
// ==========================================

for (const sm of SEASONALITY_METRICS) {
  registerMetricDef({
    id: `heatmap.${sm.metric}`,
    kind: 'matrix',
    label: `Heatmap: ${sm.label}`,
    unit: sm.unit,
    formula: `Cell(dow, hour) = ${sm.label} across bars where Day=dow and Hour=hour`,
    conventions: [
      ...sm.conventions,
      'Bivariate cross-tabulation: 7 days × 24 hours (168 cells)',
      'Multiple testing hazard: 168 simultaneous buckets',
    ],
    paramsSchema: {
      startMs: { type: 'number' },
      endMs: { type: 'number' },
    },
    compute: (rows) => {
      const cells = computeHeatmap(rows, sm.metric);
      const keys: MatrixResultCell[] = cells.map((c) => ({
        key: `${c.dow}:${c.hour}`,
        label: `${DOW_LABELS[c.dow]} ${String(c.hour).padStart(2, '0')}:00 UTC`,
        value: c.value,
        n: c.n,
        dow: c.dow,
        hour: c.hour,
      }));
      return {
        kind: 'matrix',
        keys,
        trace: { metric: sm.metric, cell_count: cells.length },
      };
    },
    tolerance: DEFAULT_TOLERANCE,
    format: sm.format,
  });
}

// ==========================================
// 4. Volatility & Distribution
// ==========================================

registerMetricDef({
  id: 'volatility.rolling_vol',
  kind: 'series',
  label: 'Rolling Volatility (σ)',
  unit: 'bps',
  formula: 'σ_t = √[ 1 / (W − 1) × Σ_{i = t−W+1}^t (r_i − r̄_W)² ] × 10,000 bps',
  conventions: [
    'Sample stddev ÷(W−1) over non-null log_ret within sliding window',
    'Window W in hourly bars (default 168h = 7 days)',
    'Emits points starting at index W−1',
  ],
  paramsSchema: {
    window: { type: 'number', default: 168, description: 'Sliding window length in hourly bars' },
    startMs: { type: 'number' },
    endMs: { type: 'number' },
  },
  compute: (rows, params) => {
    const windowSize = params && typeof params.window === 'number' && params.window > 0 ? params.window : 168;
    const points = computeRollingVolatility(rows, windowSize);
    const seriesPoints: SeriesPoint[] = points.map((p) => ({
      timeMs: p.timeMs,
      value: p.volBps,
    }));
    const vals = points.map((p) => p.volBps);
    const minVal = vals.length > 0 ? Math.min(...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(...vals) : 0;
    const meanVal = vals.length > 0 ? mean(vals) : 0;
    return {
      kind: 'series',
      points: seriesPoints,
      summary: { n: points.length, min: minVal, max: maxVal, mean: meanVal },
      trace: { window: windowSize, points_count: points.length },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatBps,
});

registerMetricDef({
  id: 'volatility.distribution_mean',
  kind: 'scalar',
  label: 'Distribution Mean Return',
  unit: 'bps',
  formula: 'μ = (1 / N) × Σ log_ret × 10,000 bps',
  conventions: ['Arithmetic mean of all non-null log returns in basis points'],
  paramsSchema: {},
  compute: (rows) => {
    const stats = computeDistributionStats(rows);
    const val = stats?.meanBps ?? 0;
    return {
      kind: 'scalar',
      value: val,
      n: getLogReturns(rows).length,
      trace: { mean_bps: val },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatSignedBps,
});

registerMetricDef({
  id: 'volatility.distribution_std',
  kind: 'scalar',
  label: 'Distribution Sample Std Dev',
  unit: 'bps',
  formula: 's = √[ 1 / (N − 1) × Σ (r_i − μ)² ] × 10,000 bps',
  conventions: ['Sample standard deviation ÷(N−1)', 'null log_ret excluded'],
  paramsSchema: {},
  compute: (rows) => {
    const stats = computeDistributionStats(rows);
    const val = stats?.stdBps ?? 0;
    return {
      kind: 'scalar',
      value: val,
      n: getLogReturns(rows).length,
      trace: { std_bps: val },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatBps,
});

registerMetricDef({
  id: 'volatility.distribution_skewness',
  kind: 'scalar',
  label: 'Distribution Skewness (g₁)',
  unit: 'ratio',
  formula: 'g₁ = m₃ / m₂^{3/2}, where m_k = (1 / N) × Σ (r_i − μ)^k',
  conventions: ['Fisher-Pearson standardized population 3rd moment', 'Unbiased population divisor N'],
  paramsSchema: {},
  compute: (rows) => {
    const stats = computeDistributionStats(rows);
    const val = stats?.skewness ?? 0;
    return {
      kind: 'scalar',
      value: val,
      n: getLogReturns(rows).length,
      trace: { skewness: val },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatRatio,
});

registerMetricDef({
  id: 'volatility.distribution_kurtosis',
  kind: 'scalar',
  label: 'Distribution Excess Kurtosis (g₂)',
  unit: 'ratio',
  formula: 'g₂ = (m₄ / m₂²) − 3',
  conventions: [
    'Excess kurtosis relative to Gaussian normal distribution (normal = 0)',
    'g₂ > 0 indicates fat tails / leptokurtosis',
  ],
  paramsSchema: {},
  compute: (rows) => {
    const stats = computeDistributionStats(rows);
    const val = stats?.kurtosis ?? 0;
    return {
      kind: 'scalar',
      value: val,
      n: getLogReturns(rows).length,
      trace: { kurtosis: val },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatRatio,
});

registerMetricDef({
  id: 'volatility.quantiles',
  kind: 'grouped',
  label: 'Empirical Quantiles',
  unit: 'bps',
  formula: 'Q(p) = sorted_returns[ floor(p × N) ] in basis points',
  conventions: ['Nearest-rank discrete quantile method', 'Sorted non-null log returns in bps'],
  paramsSchema: {},
  compute: (rows) => {
    const stats = computeDistributionStats(rows);
    if (!stats) return { kind: 'grouped', keys: [], trace: {} };
    const q = stats.quantiles;
    const keys: GroupedResultKey[] = [
      { key: 'p1', label: '1st Percentile (p1)', value: q.p1, n: getLogReturns(rows).length },
      { key: 'p5', label: '5th Percentile (p5)', value: q.p5, n: getLogReturns(rows).length },
      { key: 'p25', label: '25th Percentile (p25)', value: q.p25, n: getLogReturns(rows).length },
      { key: 'p50', label: 'Median (p50)', value: q.p50, n: getLogReturns(rows).length },
      { key: 'p75', label: '75th Percentile (p75)', value: q.p75, n: getLogReturns(rows).length },
      { key: 'p95', label: '95th Percentile (p95)', value: q.p95, n: getLogReturns(rows).length },
      { key: 'p99', label: '99th Percentile (p99)', value: q.p99, n: getLogReturns(rows).length },
    ];
    return {
      kind: 'grouped',
      keys,
      trace: { quantiles: q },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatSignedBps,
});

registerMetricDef({
  id: 'volatility.histogram',
  kind: 'grouped',
  label: 'Return Distribution Histogram',
  unit: 'count',
  formula: 'Partition of return range into 50 equal-width bins',
  conventions: [
    'Summary-only parity: n, min, max (bins are visual formatting)',
    'Equal-width binning spanning min to max observed return',
  ],
  paramsSchema: {
    bins: { type: 'number', default: 50, description: 'Number of histogram bins' },
  },
  compute: (rows, params) => {
    const binCount = params && typeof params.bins === 'number' && params.bins > 0 ? params.bins : 50;
    const stats = computeDistributionStats(rows, binCount);
    if (!stats) return { kind: 'grouped', keys: [], trace: {} };
    const keys: GroupedResultKey[] = stats.histogram.map((b, i) => ({
      key: i,
      label: `[${b.binStart.toFixed(1)}, ${b.binEnd.toFixed(1)}] bps`,
      value: b.count,
      n: b.count,
    }));
    const rets = getLogReturns(rows).map((r) => r * 10000);
    return {
      kind: 'grouped',
      keys,
      trace: {
        bin_count: binCount,
        min_bps: rets.length > 0 ? Math.min(...rets) : 0,
        max_bps: rets.length > 0 ? Math.max(...rets) : 0,
      },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatCount,
});

// ==========================================
// 5. Order Flow
// ==========================================

registerMetricDef({
  id: 'flow.cvd',
  kind: 'series',
  label: 'Cumulative Taker Delta (CVD)',
  unit: 'BTC',
  formula: 'Δ_t = (2 × taker_buy_volume_t) − volume_t,   CVD_t = Σ_{i=0}^t Δ_i',
  conventions: [
    'Net aggressive market order imbalance in contracts/BTC',
    'Unbounded cumulative prefix sum',
  ],
  paramsSchema: {
    startMs: { type: 'number' },
    endMs: { type: 'number' },
  },
  compute: (rows) => {
    const points = computeCumulativeTakerDelta(rows);
    const seriesPoints: SeriesPoint[] = points.map((p) => ({
      timeMs: p.timeMs,
      value: p.cumDelta,
      delta: p.delta,
    }));
    const vals = points.map((p) => p.cumDelta);
    const minVal = vals.length > 0 ? Math.min(...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(...vals) : 0;
    const meanVal = vals.length > 0 ? mean(vals) : 0;
    const finalDelta = points.length > 0 ? points[points.length - 1].cumDelta : 0;
    return {
      kind: 'series',
      points: seriesPoints,
      summary: { n: points.length, min: minVal, max: maxVal, mean: meanVal },
      trace: { net_total_btc: finalDelta, total_points: points.length },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatBtc,
});

registerMetricDef({
  id: 'flow.taker_buy_ratio',
  kind: 'grouped',
  label: 'Hourly Taker Buy Ratio (TBR)',
  unit: '%',
  formula: 'TBR_h = ( Σ_{t ∈ h} taker_buy_volume_t / Σ_{t ∈ h} volume_t ) × 100%',
  conventions: [
    'Ratio of sums expressed as percentage',
    '>50% indicates aggressive buyer dominance',
  ],
  paramsSchema: {},
  compute: (rows) => {
    const results = computeSeasonality(rows, 'hour', 'taker_buy_ratio');
    const keys: GroupedResultKey[] = results.map((r) => ({
      key: r.bucket,
      label: `${String(r.bucket).padStart(2, '0')}:00 UTC`,
      value: r.value * 100, // percentage
      n: r.n,
    }));
    return {
      kind: 'grouped',
      keys,
      trace: { hourly_buckets: 24 },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatPct,
});

// ==========================================
// 6. Calendar & Risk
// ==========================================

registerMetricDef({
  id: 'calendar.monthly_returns',
  kind: 'matrix',
  label: 'Monthly Returns (Year × Month)',
  unit: '%',
  formula: 'R_{y,m} = ((P_close_{last} − P_open_{first}) / P_open_{first}) × 100%',
  conventions: [
    'Open of first hourly candle of the month to close of last candle',
    'Exact calendar months (28–31 days, 672–744 bars)',
  ],
  paramsSchema: {},
  compute: (rows) => {
    const monthly = computeMonthlyReturns(rows);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const keys: MatrixResultCell[] = monthly.map((m) => ({
      key: `${m.year}-${String(m.month + 1).padStart(2, '0')}`,
      label: `${monthNames[m.month]} ${m.year}`,
      value: m.returnPct,
      n: 0,
      year: m.year,
      month: m.month,
      startPrice: m.startPrice,
      endPrice: m.endPrice,
    }));
    return {
      kind: 'matrix',
      keys,
      trace: { monthly_count: monthly.length },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: (v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`,
});

registerMetricDef({
  id: 'calendar.ytd',
  kind: 'grouped',
  label: 'Year-to-Date (YTD) Compound Return',
  unit: '%',
  formula: 'R_YTD = [ Π_{m=1}^M (1 + R_m / 100) − 1 ] × 100%',
  conventions: [
    'Discrete monthly compounding product',
    'Current year includes available months to date',
  ],
  paramsSchema: {},
  compute: (rows) => {
    const monthly = computeMonthlyReturns(rows);
    const years = Array.from(new Set(monthly.map((m) => m.year))).sort((a, b) => a - b);
    const keys: GroupedResultKey[] = years.map((y) => {
      const yearMonths = monthly.filter((m) => m.year === y);
      let prod = 1;
      for (const m of yearMonths) {
        prod *= 1 + m.returnPct / 100;
      }
      const ytd = (prod - 1) * 100;
      return {
        key: y,
        label: String(y),
        value: ytd,
        n: yearMonths.length,
      };
    });
    return {
      kind: 'grouped',
      keys,
      trace: { years_count: years.length },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: (v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`,
});

registerMetricDef({
  id: 'calendar.drawdown_series',
  kind: 'series',
  label: 'Drawdown Series',
  unit: '%',
  formula: 'Drawdown_t = ((Close_t − Peak_t) / Peak_t) × 100%',
  conventions: [
    'Peak_t = max_{i ≤ t} Close_i (running high-water mark)',
    'Hourly bar close evaluations',
  ],
  paramsSchema: {},
  compute: (rows) => {
    const { series, maxDrawdownPct } = computeDrawdownSeries(rows);
    const points: SeriesPoint[] = series.map((s) => ({
      timeMs: s.timeMs,
      value: s.drawdownPct,
      peak: s.peak,
      close: s.close,
    }));
    const vals = series.map((s) => s.drawdownPct);
    const minVal = vals.length > 0 ? Math.min(...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(...vals) : 0;
    const meanVal = vals.length > 0 ? mean(vals) : 0;
    return {
      kind: 'series',
      points,
      summary: { n: series.length, min: minVal, max: maxVal, mean: meanVal },
      trace: { max_drawdown_pct: maxDrawdownPct, points_count: series.length },
    };
  },
  tolerance: DEFAULT_TOLERANCE,
  format: formatPct,
});

// ==========================================
// 7. Quality & Provenance
// ==========================================

registerMetricDef({
  id: 'quality.checksums',
  kind: 'provenance',
  label: 'Binance Archive Checksum Audit',
  unit: 'count',
  formula: 'SHA-256(archive.zip) == Binance_Official_Checksum',
  conventions: [
    'Every monthly and daily archive validated against Binance Vision official .CHECKSUM files',
    'Verified independently by external verification kit',
  ],
  paramsSchema: {},
  compute: (_rows, _p, ctx) => ({
    kind: 'provenance',
    report: {
      checksums_verified: ctx?.qualityData?.checksums_verified ?? 0,
      total_files: (ctx?.meta?.files_downloaded?.monthly ?? 0) + (ctx?.meta?.files_downloaded?.daily ?? 0),
    },
    sources: [{ name: 'Binance Data Portal Checksums', url: 'https://data.binance.vision/' }],
    trace: { verified: ctx?.qualityData?.checksums_verified },
  }),
  tolerance: DEFAULT_TOLERANCE,
  format: formatCount,
});

registerMetricDef({
  id: 'quality.gaps',
  kind: 'provenance',
  label: 'Exchange Maintenance Gaps',
  unit: 'count',
  formula: 'Continuous chronological hours strictly preserved with zero synthetic forward-filling',
  conventions: [
    'Missing hours reflect actual matching engine outage intervals',
    'Zero synthetic bars injected into historical series',
  ],
  paramsSchema: {},
  compute: (_rows, _p, ctx) => ({
    kind: 'provenance',
    report: {
      missing_ranges: ctx?.qualityData?.missing_ranges ?? [],
      gaps_count: ctx?.qualityData?.missing_ranges?.length ?? 0,
    },
    sources: [{ name: 'Binance System Maintenance Logs', url: 'https://www.binance.com/en/support/announcement' }],
    trace: { gaps: ctx?.qualityData?.missing_ranges },
  }),
  tolerance: DEFAULT_TOLERANCE,
  format: formatCount,
});

registerMetricDef({
  id: 'quality.provenance',
  kind: 'provenance',
  label: 'Pipeline Data Lineage & Provenance',
  unit: 'string',
  formula: 'Immutable Parquet release artifact generated via automated pipeline',
  conventions: [
    'hyparquet zero-network in-browser range requests',
    'Client reads static release artifact directly',
  ],
  paramsSchema: {},
  compute: (_rows, _p, ctx) => ({
    kind: 'provenance',
    report: {
      release_id: ctx?.meta?.release_id ?? 'unknown',
      pipeline_git_sha: ctx?.meta?.pipeline_git_sha ?? 'unknown',
      generated_at_utc: ctx?.meta?.generated_at_utc ?? 'unknown',
    },
    sources: [
      {
        name: 'GitHub Repository Pipeline',
        url: 'https://github.com/venkat-narasimha/btc-hourly-analytics',
      },
    ],
    trace: { meta: ctx?.meta },
  }),
  tolerance: DEFAULT_TOLERANCE,
  format: (v) => String(v),
});
