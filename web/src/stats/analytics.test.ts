/**
 * Tests for advanced analytics calculations.
 */

import { describe, it, expect } from 'vitest';
import type { KlineRow } from '../types';
import {
  computeHeatmap,
  computeRollingVolatility,
  computeDistributionStats,
  computeCumulativeTakerDelta,
  computeMonthlyReturns,
  computeDrawdownSeries,
} from './analytics';

function makeRow(overrides: Partial<KlineRow> = {}): KlineRow {
  return {
    open_time_ms: 1704067200000,
    open: 40000,
    high: 40500,
    low: 39500,
    close: 40200,
    volume: 100,
    quote_volume: 4000000,
    trades: 500,
    taker_buy_volume: 60,
    taker_buy_quote_volume: 2400000,
    log_ret: 0.005,
    hour: 0,
    dow: 0,
    taker_buy_ratio: 0.6,
    hl_range: 0.025,
    ...overrides,
  };
}

describe('computeHeatmap', () => {
  it('creates 7x24 grid', () => {
    const rows = [
      makeRow({ dow: 1, hour: 10, log_ret: 0.002 }),
      makeRow({ dow: 1, hour: 10, log_ret: 0.004 }),
    ];
    const cells = computeHeatmap(rows, 'mean_return');
    expect(cells.length).toBe(7 * 24);

    const cell = cells.find(c => c.dow === 1 && c.hour === 10);
    expect(cell).toBeDefined();
    expect(cell!.n).toBe(2);
    expect(cell!.value).toBeCloseTo(30, 5); // 0.003 * 10000 = 30 bps
  });
});

describe('computeRollingVolatility', () => {
  it('returns empty when rows < windowSize', () => {
    const rows = [makeRow(), makeRow()];
    expect(computeRollingVolatility(rows, 10)).toEqual([]);
  });

  it('computes rolling vol over window', () => {
    const rows: KlineRow[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push(makeRow({
        open_time_ms: 1704067200000 + i * 3600000,
        log_ret: i % 2 === 0 ? 0.01 : -0.01,
      }));
    }
    const res = computeRollingVolatility(rows, 10);
    expect(res.length).toBe(11);
    expect(res[0].volBps).toBeGreaterThan(0);
  });
});

describe('computeDistributionStats', () => {
  it('returns null for very small dataset', () => {
    expect(computeDistributionStats([makeRow()])).toBeNull();
  });

  it('computes skewness, kurtosis, quantiles and histogram', () => {
    const rows: KlineRow[] = [];
    for (let i = 0; i < 100; i++) {
      rows.push(makeRow({ log_ret: (i - 50) * 0.0002 }));
    }
    const stats = computeDistributionStats(rows, 10);
    expect(stats).not.toBeNull();
    expect(stats!.histogram.length).toBe(10);
    expect(stats!.quantiles.p50).toBeCloseTo(0, 0);
    expect(stats!.meanBps).toBeCloseTo(-1, 1);
  });
});

describe('computeCumulativeTakerDelta', () => {
  it('calculates 2 * taker_buy - volume cumulation correctly', () => {
    const rows = [
      makeRow({ volume: 100, taker_buy_volume: 70 }), // delta = 2*70 - 100 = 40
      makeRow({ volume: 100, taker_buy_volume: 40 }), // delta = 2*40 - 100 = -20
    ];
    const points = computeCumulativeTakerDelta(rows);
    expect(points.length).toBe(2);
    expect(points[0].delta).toBe(40);
    expect(points[0].cumDelta).toBe(40);
    expect(points[1].delta).toBe(-20);
    expect(points[1].cumDelta).toBe(20);
  });
});

describe('computeMonthlyReturns', () => {
  it('aggregates returns per month', () => {
    // 2024-01-01 00:00 UTC and 2024-01-31 23:00 UTC
    const r1 = makeRow({ open_time_ms: Date.UTC(2024, 0, 1), open: 40000, close: 41000 });
    const r2 = makeRow({ open_time_ms: Date.UTC(2024, 0, 31), open: 41000, close: 44000 });
    const monthly = computeMonthlyReturns([r1, r2]);
    expect(monthly.length).toBe(1);
    expect(monthly[0].year).toBe(2024);
    expect(monthly[0].month).toBe(0);
    expect(monthly[0].returnPct).toBeCloseTo(10, 2); // (44000 - 40000) / 40000 * 100 = 10%
  });
});

describe('computeDrawdownSeries', () => {
  it('computes peak and drawdowns from close prices', () => {
    const rows = [
      makeRow({ close: 100 }), // peak=100, dd=0
      makeRow({ close: 120 }), // peak=120, dd=0
      makeRow({ close: 90 }),  // peak=120, dd = (90-120)/120 = -25%
      makeRow({ close: 108 }), // peak=120, dd = (108-120)/120 = -10%
    ];
    const { series, maxDrawdownPct } = computeDrawdownSeries(rows);
    expect(series.length).toBe(4);
    expect(series[0].drawdownPct).toBe(0);
    expect(series[1].drawdownPct).toBe(0);
    expect(series[2].drawdownPct).toBeCloseTo(-25, 2);
    expect(maxDrawdownPct).toBeCloseTo(-25, 2);
  });
});
