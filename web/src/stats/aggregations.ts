/**
 * Statistical aggregation functions for seasonality analytics.
 * All computations use log_ret (never price levels).
 * Returns in basis points (bps = log_ret × 10,000).
 */

import type { KlineRow, SeasonalityMetric } from '../types';

/** Group rows by a bucket key (hour or dow). */
export function groupBy(data: KlineRow[], key: 'hour' | 'dow'): Map<number, KlineRow[]> {
  const groups = new Map<number, KlineRow[]>();
  for (const row of data) {
    const bucket = row[key];
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(row);
  }
  return groups;
}

/** Mean of an array of numbers. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Standard deviation (population). */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Extract non-null log_ret values from rows. */
export function getLogReturns(rows: KlineRow[]): number[] {
  return rows.filter(r => r.log_ret !== null).map(r => r.log_ret as number);
}

/** Compute a metric for a group of rows. */
export function computeMetric(rows: KlineRow[], metric: SeasonalityMetric): { value: number; n: number } {
  switch (metric) {
    case 'mean_return': {
      const rets = getLogReturns(rows);
      return { value: mean(rets) * 10000, n: rets.length }; // bps
    }
    case 'volatility': {
      const rets = getLogReturns(rows);
      return { value: stddev(rets) * 10000, n: rets.length }; // bps
    }
    case 'win_rate': {
      const rets = getLogReturns(rows);
      if (rets.length === 0) return { value: 0, n: 0 };
      const wins = rets.filter(r => r > 0).length;
      return { value: (wins / rets.length) * 100, n: rets.length }; // percentage
    }
    case 'total_volume': {
      const total = rows.reduce((sum, r) => sum + r.volume, 0);
      return { value: total, n: rows.length };
    }
    case 'taker_buy_ratio': {
      // Ratio of sums: Σtaker_buy_volume / Σvolume
      const totalVol = rows.reduce((sum, r) => sum + r.volume, 0);
      const totalTaker = rows.reduce((sum, r) => sum + r.taker_buy_volume, 0);
      return { value: totalVol > 0 ? totalTaker / totalVol : 0, n: rows.length };
    }
    case 'mean_hl_range': {
      const ranges = rows.map(r => r.hl_range);
      return { value: mean(ranges) * 10000, n: rows.length }; // bps
    }
  }
}

/** Compute metric for all buckets. */
export function computeSeasonality(
  data: KlineRow[],
  key: 'hour' | 'dow',
  metric: SeasonalityMetric
): Array<{ bucket: number; value: number; n: number }> {
  const groups = groupBy(data, key);
  const maxBucket = key === 'hour' ? 24 : 7;
  const results: Array<{ bucket: number; value: number; n: number }> = [];

  for (let i = 0; i < maxBucket; i++) {
    const rows = groups.get(i) || [];
    const { value, n } = computeMetric(rows, metric);
    results.push({ bucket: i, value, n });
  }

  return results;
}

/** Metric display info. */
export const METRIC_INFO: Record<SeasonalityMetric, { label: string; unit: string }> = {
  mean_return: { label: 'Mean Return', unit: 'bps' },
  volatility: { label: 'Volatility (σ)', unit: 'bps' },
  win_rate: { label: 'Win Rate', unit: '%' },
  total_volume: { label: 'Total Volume', unit: 'BTC' },
  taker_buy_ratio: { label: 'Taker Buy Ratio', unit: 'ratio' },
  mean_hl_range: { label: 'Mean H-L Range', unit: 'bps' },
};

/** Day-of-week labels. */
export const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
