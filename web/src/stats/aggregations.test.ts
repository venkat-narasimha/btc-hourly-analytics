/**
 * Vitest tests for aggregation functions.
 * Hand-computed expected values — no network required.
 */

import { describe, it, expect } from 'vitest';
import {
  mean, stddev, getLogReturns, computeMetric,
  computeSeasonality, groupBy
} from './aggregations';
import type { KlineRow } from '../types';

/** Create a minimal KlineRow for testing. */
function makeRow(overrides: Partial<KlineRow> = {}): KlineRow {
  return {
    open_time_ms: 1704067200000,
    open: 42000,
    high: 42100,
    low: 41900,
    close: 42050,
    volume: 100,
    quote_volume: 4200000,
    trades: 500,
    taker_buy_volume: 60,
    taker_buy_quote_volume: 2520000,
    log_ret: 0.001,
    hour: 0,
    dow: 0,
    taker_buy_ratio: 0.6,
    hl_range: 0.00476,
    ...overrides,
  };
}

describe('mean', () => {
  it('computes correctly', () => {
    expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3, 10);
  });

  it('returns 0 for empty array', () => {
    expect(mean([])).toBe(0);
  });

  it('handles negative values', () => {
    expect(mean([-1, 1])).toBeCloseTo(0, 10);
  });
});

describe('stddev', () => {
  it('computes population stddev', () => {
    // stddev([1,2,3,4,5]) = sqrt(2) ≈ 1.4142
    expect(stddev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2), 5);
  });

  it('returns 0 for single value', () => {
    expect(stddev([5])).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(stddev([])).toBe(0);
  });
});

describe('getLogReturns', () => {
  it('filters out null log_ret', () => {
    const rows = [
      makeRow({ log_ret: 0.001 }),
      makeRow({ log_ret: null }),
      makeRow({ log_ret: -0.002 }),
    ];
    expect(getLogReturns(rows)).toEqual([0.001, -0.002]);
  });
});

describe('groupBy', () => {
  it('groups by hour', () => {
    const rows = [
      makeRow({ hour: 0 }),
      makeRow({ hour: 1 }),
      makeRow({ hour: 0 }),
    ];
    const groups = groupBy(rows, 'hour');
    expect(groups.get(0)?.length).toBe(2);
    expect(groups.get(1)?.length).toBe(1);
  });

  it('groups by dow', () => {
    const rows = [
      makeRow({ dow: 0 }),
      makeRow({ dow: 6 }),
      makeRow({ dow: 0 }),
    ];
    const groups = groupBy(rows, 'dow');
    expect(groups.get(0)?.length).toBe(2);
    expect(groups.get(6)?.length).toBe(1);
  });
});

describe('computeMetric', () => {
  const rows = [
    makeRow({ log_ret: 0.001, volume: 100, taker_buy_volume: 60, hl_range: 0.005 }),
    makeRow({ log_ret: -0.002, volume: 200, taker_buy_volume: 100, hl_range: 0.003 }),
    makeRow({ log_ret: 0.003, volume: 150, taker_buy_volume: 80, hl_range: 0.004 }),
  ];

  it('mean_return in bps', () => {
    // mean([0.001, -0.002, 0.003]) = 0.002/3 ≈ 0.000667
    // × 10000 = 6.667 bps
    const result = computeMetric(rows, 'mean_return');
    expect(result.value).toBeCloseTo((0.001 - 0.002 + 0.003) / 3 * 10000, 5);
    expect(result.n).toBe(3);
  });

  it('volatility in bps', () => {
    const result = computeMetric(rows, 'volatility');
    expect(result.n).toBe(3);
    expect(result.value).toBeGreaterThan(0);
  });

  it('win_rate percentage', () => {
    // 2 out of 3 returns > 0
    const result = computeMetric(rows, 'win_rate');
    expect(result.value).toBeCloseTo(66.6667, 2);
    expect(result.n).toBe(3);
  });

  it('total_volume', () => {
    const result = computeMetric(rows, 'total_volume');
    expect(result.value).toBe(450);
    expect(result.n).toBe(3);
  });

  it('taker_buy_ratio as ratio-of-sums', () => {
    // Σtaker_buy / Σvolume = (60+100+80)/(100+200+150) = 240/450
    const result = computeMetric(rows, 'taker_buy_ratio');
    expect(result.value).toBeCloseTo(240 / 450, 5);
    expect(result.n).toBe(3);
  });

  it('mean_hl_range in bps', () => {
    // mean([0.005, 0.003, 0.004]) = 0.004 × 10000 = 40 bps
    const result = computeMetric(rows, 'mean_hl_range');
    expect(result.value).toBeCloseTo(40, 5);
    expect(result.n).toBe(3);
  });

  it('handles null log_ret in mean_return', () => {
    const rowsWithNull = [
      makeRow({ log_ret: 0.001 }),
      makeRow({ log_ret: null }),
    ];
    const result = computeMetric(rowsWithNull, 'mean_return');
    expect(result.value).toBeCloseTo(10, 5); // 0.001 × 10000
    expect(result.n).toBe(1); // only 1 non-null
  });
});

describe('computeSeasonality', () => {
  it('produces 24 buckets for hour', () => {
    const rows = [makeRow({ hour: 5, log_ret: 0.001 })];
    const result = computeSeasonality(rows, 'hour', 'mean_return');
    expect(result.length).toBe(24);
    expect(result[5].value).toBeCloseTo(10, 5);
    expect(result[5].n).toBe(1);
    expect(result[0].n).toBe(0);
  });

  it('produces 7 buckets for dow', () => {
    const rows = [makeRow({ dow: 3, log_ret: -0.001 })];
    const result = computeSeasonality(rows, 'dow', 'mean_return');
    expect(result.length).toBe(7);
    expect(result[3].value).toBeCloseTo(-10, 5);
  });
});
