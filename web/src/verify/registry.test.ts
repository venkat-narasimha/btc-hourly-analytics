import { describe, it, expect } from 'vitest';
import {
  getAllMetricDefs,
  getMetricDef,
} from './registry';
import type { KlineRow, Meta, QualityReport } from '../types';

function createMockRows(count = 200): KlineRow[] {
  const rows: KlineRow[] = [];
  const startMs = 1600000000000;
  let price = 10000;

  for (let i = 0; i < count; i++) {
    const openTime = startMs + i * 3600000;
    const change = (Math.sin(i / 10) * 50) + ((i % 5) - 2) * 10;
    const open = price;
    const close = Math.max(100, open + change);
    const high = Math.max(open, close) + 20;
    const low = Math.min(open, close) - 20;
    const volume = 100 + (i % 20) * 10;
    const takerVol = volume * (0.45 + (i % 10) * 0.01);
    const logRet = i === 0 ? null : Math.log(close / rows[i - 1].close);
    const d = new Date(openTime);

    rows.push({
      open_time_ms: openTime,
      open,
      high,
      low,
      close,
      volume,
      quote_volume: volume * close,
      trades: 1000,
      taker_buy_volume: takerVol,
      taker_buy_quote_volume: takerVol * close,
      log_ret: logRet,
      hour: d.getUTCHours(),
      dow: (d.getUTCDay() + 6) % 7, // Mon=0 .. Sun=6
      taker_buy_ratio: volume > 0 ? takerVol / volume : null,
      hl_range: (high - low) / open,
    });
    price = close;
  }
  return rows;
}

const mockMeta: Meta = {
  schema_version: '1.0',
  symbol: 'BTCUSDT',
  interval: '1h',
  market: 'futures',
  first_open_ms: 1600000000000,
  last_open_ms: 1600000000000 + 200 * 3600000,
  rows: 200,
  release_id: 'test-release-001',
  pipeline_git_sha: 'abc1234',
  generated_at_utc: '2026-11-20T20:00:00Z',
  files_downloaded: { monthly: 10, daily: 5 },
  source_base_url: 'https://data.binance.vision',
};

const mockQuality: QualityReport = {
  actual_rows: 200,
  expected_hours: 200,
  coverage_pct: 100.0,
  missing_ranges: [],
  per_year_row_counts: { '2020': 200 },
  checksums_verified: 15,
  duplicates_removed: 0,
  zero_volume_bars: 0,
  files_ms: 15,
  files_us: 0,
  header_files: 1,
  quarantined_rows: [],
  warnings: [],
};

describe('Metric Registry (Phase A)', () => {
  it('registers all required inventory items', () => {
    const allDefs = getAllMetricDefs();
    expect(allDefs.length).toBeGreaterThanOrEqual(25);

    const requiredIds = [
      'kpi.total_bars',
      'kpi.span_years',
      'kpi.coverage_pct',
      'kpi.latest_close',
      'kpi.period_return_pct',
      'kpi.max_drawdown',
      'kpi.best_hour',
      'kpi.worst_hour',
      'kpi.best_dow',
      'kpi.worst_dow',
      'kpi.hourly_win_rate',
      'kpi.mean_hourly_return',
      'kpi.per_year_counts',
      'seasonality.mean_return',
      'seasonality.volatility',
      'seasonality.win_rate',
      'seasonality.total_volume',
      'seasonality.taker_buy_ratio',
      'seasonality.mean_hl_range',
      'heatmap.mean_return',
      'volatility.rolling_vol',
      'volatility.distribution_mean',
      'volatility.distribution_std',
      'volatility.distribution_skewness',
      'volatility.distribution_kurtosis',
      'volatility.quantiles',
      'volatility.histogram',
      'flow.cvd',
      'flow.taker_buy_ratio',
      'calendar.monthly_returns',
      'calendar.ytd',
      'calendar.drawdown_series',
      'quality.checksums',
      'quality.gaps',
      'quality.provenance',
    ];

    for (const reqId of requiredIds) {
      const def = getMetricDef(reqId);
      expect(def, `Missing required definition: ${reqId}`).toBeDefined();
    }
  });

  it('validates structure and invariants of every registered MetricDef', () => {
    const rows = createMockRows(200);

    for (const def of getAllMetricDefs()) {
      expect(def.id).toBeTruthy();
      expect(def.label).toBeTruthy();
      expect(def.unit).toBeTruthy();
      expect(def.formula.trim().length).toBeGreaterThan(0);
      expect(def.conventions.length).toBeGreaterThan(0);
      expect(def.tolerance).toHaveProperty('rel');
      expect(def.tolerance).toHaveProperty('abs');

      // Test compute
      const res = def.compute(rows, {}, { meta: mockMeta, qualityData: mockQuality });
      expect(res).toBeDefined();
      expect(res.kind).toBe(def.kind);

      if (res.kind === 'scalar') {
        expect(res.value !== undefined).toBe(true);
        expect(res.n).toBeGreaterThanOrEqual(0);
      } else if (res.kind === 'grouped' || res.kind === 'matrix') {
        expect(Array.isArray(res.keys)).toBe(true);
      } else if (res.kind === 'series') {
        expect(Array.isArray(res.points)).toBe(true);
        expect(res.summary).toBeDefined();
      } else if (res.kind === 'provenance') {
        expect(res.report).toBeDefined();
        expect(Array.isArray(res.sources)).toBe(true);
      }

      // Test format function
      const formatted = def.format(12.345);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    }
  });

  it('resolves compound seasonality IDs', () => {
    const hourDef = getMetricDef('seasonality.mean_return.hour');
    expect(hourDef).toBeDefined();
    expect(hourDef?.id).toBe('seasonality.mean_return');

    const dowDef = getMetricDef('seasonality.mean_return.dow');
    expect(dowDef).toBeDefined();
    expect(dowDef?.id).toBe('seasonality.mean_return');
  });

  it('matches snapshot per metric definition', () => {
    const defs = getAllMetricDefs().map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      unit: d.unit,
      formula: d.formula,
      conventions: d.conventions,
    }));
    expect(defs).toMatchSnapshot();
  });
});
