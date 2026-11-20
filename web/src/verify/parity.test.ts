import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { KlineRow, Meta, QualityReport } from '../types';
import { getAllMetricDefs, getMetricDef } from './registry';
import { compareAppAndSqlResults, isWithinTolerance } from './parity';

function generateDeterministicSyntheticRows(count = 2200): KlineRow[] {
  const rows: KlineRow[] = [];
  // Start on 2023-11-01 00:00:00 UTC (Wednesday)
  let currentMs = 1698796800000;
  let price = 35000;

  for (let i = 0; i < count; i++) {
    // Inject a 3-hour gap at index 120 (maintenance outage)
    if (i === 120) {
      currentMs += 3 * 3600000;
    }

    const d = new Date(currentMs);
    const hour = d.getUTCHours();
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6

    // Inject 0 volume at index 250
    const isZeroVolume = i === 250;
    const volume = isZeroVolume ? 0 : 100 + ((i * 7) % 150);
    const takerVol = isZeroVolume ? 0 : volume * (0.4 + (((i % 11) * 0.02)));

    // Price change: periodic component + drift
    const change = Math.sin(i / 15) * 80 + Math.cos(i / 50) * 40 + ((i % 7) - 3) * 15;
    const open = price;
    const close = Math.max(1000, open + change);
    const high = Math.max(open, close) + 25;
    const low = Math.min(open, close) - 25;

    // First bar or after gap: log_ret is null if first or discontinuous
    let logRet: number | null = null;
    if (i > 0 && i !== 120) {
      logRet = Math.log(close / rows[rows.length - 1].close);
    }

    const hlRange = open > 0 ? (high - low) / open : 0;
    const takerRatio = volume > 0 ? takerVol / volume : null;

    rows.push({
      open_time_ms: currentMs,
      open,
      high,
      low,
      close,
      volume,
      quote_volume: volume * close,
      trades: isZeroVolume ? 0 : 500 + (i % 300),
      taker_buy_volume: takerVol,
      taker_buy_quote_volume: takerVol * close,
      log_ret: logRet,
      hour,
      dow,
      taker_buy_ratio: takerRatio,
      hl_range: hlRange,
    });

    price = close;
    currentMs += 3600000; // +1 hour
  }

  return rows;
}

const mockMeta: Meta = {
  schema_version: '1.0',
  symbol: 'BTCUSDT',
  market: 'usdt_futures',
  interval: '1h',
  release_id: 'test-synthetic-2024-v1',
  pipeline_git_sha: 'synthetic0000',
  generated_at_utc: '2024-02-01T00:00:00Z',
  first_open_ms: 1698796800000,
  last_open_ms: 1706742000000,
  rows: 2200,
  files_downloaded: { monthly: 3, daily: 0 },
  source_base_url: 'https://data.binance.vision',
};

const mockQuality: QualityReport = {
  coverage_pct: 99.86,
  actual_rows: 2200,
  expected_hours: 2203,
  checksums_verified: 3,
  duplicates_removed: 0,
  quarantined_rows: [],
  zero_volume_bars: 1,
  files_ms: 3,
  files_us: 0,
  header_files: 3,
  per_year_row_counts: { '2023': 1464, '2024': 736 },
  warnings: [],
  missing_ranges: [
    {
      start_ms: 1699228800000,
      end_ms: 1699239600000,
      hours: 3,
    },
  ],
};

describe('parity_runner', () => {
  describe('isWithinTolerance', () => {
    it('handles exact matches', () => {
      expect(isWithinTolerance(10.5, 10.5, { rel: 1e-9, abs: 1e-9 }).match).toBe(true);
      expect(isWithinTolerance(0, 0, { rel: 1e-9, abs: 1e-9 }).match).toBe(true);
    });

    it('handles relative tolerance', () => {
      expect(isWithinTolerance(1000000, 1000000.0001, { rel: 1e-6, abs: 1e-9 }).match).toBe(true);
      expect(isWithinTolerance(1000000, 1000010, { rel: 1e-6, abs: 1e-9 }).match).toBe(false);
    });

    it('handles null values', () => {
      expect(isWithinTolerance(null, null, { rel: 1e-9, abs: 1e-9 }).match).toBe(true);
      expect(isWithinTolerance(null, 5, { rel: 1e-9, abs: 1e-9 }).match).toBe(false);
      expect(isWithinTolerance(5, null, { rel: 1e-9, abs: 1e-9 }).match).toBe(false);
    });
  });

  describe('compareAppAndSqlResults', () => {
    it('compares scalar definitions correctly', () => {
      const def = getMetricDef('kpi.total_bars')!;
      const appResult = { kind: 'scalar' as const, value: 100, n: 100, trace: {} };
      const sqlRowsMatch = [{ value: 100 }];
      const sqlRowsMismatch = [{ value: 99 }];

      expect(compareAppAndSqlResults(def, appResult, sqlRowsMatch).status).toBe('match');
      expect(compareAppAndSqlResults(def, appResult, sqlRowsMismatch).status).toBe('mismatch');
    });

    it('compares grouped definitions by key correctly', () => {
      const def = getMetricDef('seasonality.mean_return')!;
      const appResult = {
        kind: 'grouped' as const,
        keys: [
          { key: 0, value: 5.2, n: 10 },
          { key: 1, value: -2.1, n: 10 },
        ],
        trace: {},
      };
      const sqlRowsMatch = [
        { key: 0, value: 5.2 },
        { key: 1, value: -2.1 },
      ];
      const sqlRowsMismatch = [
        { key: 0, value: 5.2 },
        { key: 1, value: -1.0 },
      ];

      expect(compareAppAndSqlResults(def, appResult, sqlRowsMatch).status).toBe('match');
      expect(compareAppAndSqlResults(def, appResult, sqlRowsMismatch).status).toBe('mismatch');
    });
  });

  describe('CI Parity Cases Generator', () => {
    it('generates synthetic dataset and parity cases file for external python runner', () => {
      const rows = generateDeterministicSyntheticRows(2200);
      expect(rows.length).toBe(2200);

      const allDefs = getAllMetricDefs();
      const sqlDefs = allDefs.filter((d) => d.kind !== 'provenance' && !!d.sql);

      // Exactly 36 non-provenance definitions have SQL parity (4 provenance definitions have no SQL)
      expect(sqlDefs.length).toBe(36);

      const cases: Array<{
        id: string;
        kind: string;
        params: Record<string, any>;
        sql: string;
        expected: any;
        tolerance: { rel: number; abs: number };
      }> = [];

      for (const def of sqlDefs) {
        // Base test case without parameters
        const baseParams: Record<string, any> = {};
        const baseExpected = def.compute(rows, baseParams, { meta: mockMeta, qualityData: mockQuality });
        const baseSql = def.sql!(baseParams);

        cases.push({
          id: def.id,
          kind: def.kind,
          params: baseParams,
          sql: baseSql,
          expected: baseExpected,
          tolerance: def.tolerance,
        });

        // If seasonality, also generate dow bucket case
        if (def.id.startsWith('seasonality.')) {
          const dowParams = { bucket: 'dow' };
          const dowExpected = def.compute(rows, dowParams, { meta: mockMeta, qualityData: mockQuality });
          const dowSql = def.sql!(dowParams);
          cases.push({
            id: `${def.id}.dow`,
            kind: def.kind,
            params: dowParams,
            sql: dowSql,
            expected: dowExpected,
            tolerance: def.tolerance,
          });
        }

        // If rolling_vol, test custom window 24
        if (def.id === 'volatility.rolling_vol') {
          const wParams = { window: 24 };
          const wExpected = def.compute(rows, wParams, { meta: mockMeta, qualityData: mockQuality });
          const wSql = def.sql!(wParams);
          cases.push({
            id: `${def.id}.window24`,
            kind: def.kind,
            params: wParams,
            sql: wSql,
            expected: wExpected,
            tolerance: def.tolerance,
          });
        }
      }

      // Write synthetic rows CSV and parity cases JSON into verification/fixtures
      const fixturesDir = path.resolve(__dirname, '../../../verification/fixtures');
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }

      // 1. Synthetic CSV
      const csvHeader = [
        'open_time_ms',
        'open',
        'high',
        'low',
        'close',
        'volume',
        'quote_volume',
        'trades',
        'taker_buy_volume',
        'taker_buy_quote_volume',
        'log_ret',
        'hour',
        'dow',
        'taker_buy_ratio',
        'hl_range',
      ].join(',');

      const csvLines = rows.map((r) =>
        [
          r.open_time_ms,
          r.open,
          r.high,
          r.low,
          r.close,
          r.volume,
          r.quote_volume,
          r.trades,
          r.taker_buy_volume,
          r.taker_buy_quote_volume,
          r.log_ret !== null && r.log_ret !== undefined ? r.log_ret : '',
          r.hour,
          r.dow,
          r.taker_buy_ratio !== null && r.taker_buy_ratio !== undefined ? r.taker_buy_ratio : '',
          r.hl_range,
        ].join(',')
      );

      const csvContent = [csvHeader, ...csvLines].join('\n');
      const csvPath = path.join(fixturesDir, 'synthetic_klines.csv');
      fs.writeFileSync(csvPath, csvContent, 'utf-8');

      // 2. Parity Cases JSON
      const jsonPath = path.join(fixturesDir, 'parity_cases.json');
      fs.writeFileSync(jsonPath, JSON.stringify(cases, null, 2), 'utf-8');

      expect(fs.existsSync(csvPath)).toBe(true);
      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(cases.length).toBe(43); // 36 base + 6 seasonality dow + 1 rolling vol window 24
    });
  });
});
