/**
 * Advanced analytics calculations for Phase 3 tabs:
 * - 7x24 Heatmap (dow x hour)
 * - Rolling Volatility
 * - Return Distribution (skewness, kurtosis, quantiles, histogram bins)
 * - Order Flow (cumulative taker delta)
 * - Calendar (Year x Month return matrix)
 * - Risk (drawdown series & max drawdown)
 */

import type { KlineRow, SeasonalityMetric } from '../types';
import { computeMetric, getLogReturns, mean, stddev } from './aggregations';

/** Heatmap cell data: [dow, hour, value, n] */
export interface HeatmapCell {
  dow: number;
  hour: number;
  value: number;
  n: number;
}

/** Compute 7x24 heatmap matrix. */
export function computeHeatmap(
  data: KlineRow[],
  metric: SeasonalityMetric
): HeatmapCell[] {
  // 7 days x 24 hours grid
  const grid: KlineRow[][][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => [])
  );

  for (const row of data) {
    if (row.dow >= 0 && row.dow < 7 && row.hour >= 0 && row.hour < 24) {
      grid[row.dow][row.hour].push(row);
    }
  }

  const cells: HeatmapCell[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const rows = grid[d][h];
      const { value, n } = computeMetric(rows, metric);
      cells.push({ dow: d, hour: h, value, n });
    }
  }
  return cells;
}

/** Rolling volatility point. */
export interface RollingVolPoint {
  timeMs: number;
  volBps: number;
}

/**
 * Compute rolling volatility (σ of log_ret in bps) over a sliding window of `windowSize` bars.
 * Ignores null log_ret and computes σ strictly over non-null returns within each window.
 */
export function computeRollingVolatility(
  data: KlineRow[],
  windowSize = 168
): RollingVolPoint[] {
  if (data.length < windowSize) return [];

  const points: RollingVolPoint[] = [];

  for (let i = windowSize - 1; i < data.length; i++) {
    const start = i - windowSize + 1;
    const validRets: number[] = [];
    for (let j = start; j <= i; j++) {
      const ret = data[j].log_ret;
      if (ret !== null && ret !== undefined) {
        validRets.push(ret);
      }
    }
    const sigma = stddev(validRets) * 10000; // in bps (sample stddev)
    points.push({
      timeMs: data[i].open_time_ms,
      volBps: sigma,
    });
  }
  return points;
}

/** Distribution summary statistics. */
export interface DistributionStats {
  meanBps: number;
  stdBps: number;
  skewness: number;
  kurtosis: number;
  quantiles: {
    p1: number;
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    p99: number;
  };
  histogram: Array<{ binStart: number; binEnd: number; count: number }>;
}

/** Compute distribution statistics over log returns. */
export function computeDistributionStats(
  data: KlineRow[],
  binCount = 50
): DistributionStats | null {
  const rets = getLogReturns(data).map(r => r * 10000); // in bps
  if (rets.length < 4) return null;

  const m = mean(rets);
  const s = stddev(rets); // Sample stddev (÷N-1)

  // Population moments g1 (skewness) and g2 (excess kurtosis) per standard definitions
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const r of rets) {
    const diff = r - m;
    m2 += diff ** 2;
    m3 += diff ** 3;
    m4 += diff ** 4;
  }
  m2 /= rets.length;
  m3 /= rets.length;
  m4 /= rets.length;

  const sigmaPop = Math.sqrt(m2);
  const skewness = sigmaPop > 0 ? m3 / (sigmaPop ** 3) : 0;
  const kurtosis = sigmaPop > 0 ? m4 / (sigmaPop ** 4) - 3 : 0;

  // Quantiles (sorted)
  const sorted = [...rets].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = Math.min(Math.floor(p * sorted.length), sorted.length - 1);
    return sorted[idx];
  };

  const quantiles = {
    p1: q(0.01),
    p5: q(0.05),
    p25: q(0.25),
    p50: q(0.50),
    p75: q(0.75),
    p95: q(0.95),
    p99: q(0.99),
  };

  // Histogram bins
  const minVal = sorted[0];
  const maxVal = sorted[sorted.length - 1];
  const range = maxVal - minVal || 1;
  const binWidth = range / binCount;

  const bins: Array<{ binStart: number; binEnd: number; count: number }> = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({
      binStart: minVal + i * binWidth,
      binEnd: minVal + (i + 1) * binWidth,
      count: 0,
    });
  }

  for (const r of rets) {
    let binIdx = Math.floor((r - minVal) / binWidth);
    if (binIdx >= binCount) binIdx = binCount - 1;
    if (binIdx < 0) binIdx = 0;
    bins[binIdx].count++;
  }

  return {
    meanBps: m,
    stdBps: s,
    skewness,
    kurtosis,
    quantiles,
    histogram: bins,
  };
}

/** Cumulative taker delta point. */
export interface TakerDeltaPoint {
  timeMs: number;
  delta: number;
  cumDelta: number;
}

/**
 * Compute cumulative taker delta: Σ(2 * taker_buy_volume - volume).
 * Represents cumulative net aggressive taker market order flow in BTC.
 */
export function computeCumulativeTakerDelta(data: KlineRow[]): TakerDeltaPoint[] {
  let cum = 0;
  const points: TakerDeltaPoint[] = [];

  for (const row of data) {
    const delta = 2 * row.taker_buy_volume - row.volume;
    cum += delta;
    points.push({
      timeMs: row.open_time_ms,
      delta,
      cumDelta: cum,
    });
  }

  return points;
}

/** Monthly return record. */
export interface MonthlyReturn {
  year: number;
  month: number; // 0-11
  returnPct: number;
  startPrice: number;
  endPrice: number;
}

/** Compute Year x Month return matrix. */
export function computeMonthlyReturns(data: KlineRow[]): MonthlyReturn[] {
  if (data.length === 0) return [];

  // Group by year-month
  const groups = new Map<string, { year: number; month: number; first: KlineRow; last: KlineRow }>();

  for (const row of data) {
    const d = new Date(row.open_time_ms);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const key = `${year}-${month}`;

    if (!groups.has(key)) {
      groups.set(key, { year, month, first: row, last: row });
    } else {
      groups.get(key)!.last = row;
    }
  }

  const results: MonthlyReturn[] = [];
  for (const g of groups.values()) {
    const retPct = ((g.last.close - g.first.open) / g.first.open) * 100;
    results.push({
      year: g.year,
      month: g.month,
      returnPct: retPct,
      startPrice: g.first.open,
      endPrice: g.last.close,
    });
  }

  return results.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
}

/** Drawdown curve point. */
export interface DrawdownPoint {
  timeMs: number;
  close: number;
  peak: number;
  drawdownPct: number;
}

/** Compute drawdown series from close prices. */
export function computeDrawdownSeries(data: KlineRow[]): {
  series: DrawdownPoint[];
  maxDrawdownPct: number;
} {
  let peak = -Infinity;
  let maxDd = 0;
  const series: DrawdownPoint[] = [];

  for (const row of data) {
    if (row.close > peak) {
      peak = row.close;
    }
    const dd = peak > 0 ? ((row.close - peak) / peak) * 100 : 0;
    if (dd < maxDd) {
      maxDd = dd;
    }
    series.push({
      timeMs: row.open_time_ms,
      close: row.close,
      peak,
      drawdownPct: dd,
    });
  }

  return { series, maxDrawdownPct: maxDd };
}

/** Session hours definition in UTC. */
export interface TradingSession {
  name: string;
  startHour: number;
  endHour: number;
  color: string;
}

export const TRADING_SESSIONS: TradingSession[] = [
  { name: 'Asia', startHour: 0, endHour: 8, color: '#3b82f6' },
  { name: 'Europe', startHour: 7, endHour: 16, color: '#10b981' },
  { name: 'US', startHour: 13, endHour: 22, color: '#f59e0b' },
];
