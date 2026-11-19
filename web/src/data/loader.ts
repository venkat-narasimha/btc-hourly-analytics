/**
 * Data loading module.
 * Fetches meta.json + quality_report.json + parquet via hyparquet.
 * Browser NEVER fetches from Binance at runtime.
 */

import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet';
import type { KlineRow, Meta, QualityReport } from '../types';

const DATA_BASE = '/data/current';

export async function fetchMeta(): Promise<Meta> {
  const resp = await fetch(`${DATA_BASE}/meta.json`, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`Failed to fetch meta.json: ${resp.status}`);
  return resp.json();
}

export async function fetchQualityReport(): Promise<QualityReport> {
  const resp = await fetch(`${DATA_BASE}/quality_report.json`, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`Failed to fetch quality_report.json: ${resp.status}`);
  return resp.json();
}

export async function fetchKlines(): Promise<KlineRow[]> {
  const url = `${DATA_BASE}/btcusdt_1h.parquet`;
  const file = await asyncBufferFromUrl({ url });
  const rows: KlineRow[] = [];
  await parquetReadObjects({
    file,
    onComplete: (data: Record<string, unknown>[]) => {
      for (const row of data) {
        rows.push(row as unknown as KlineRow);
      }
    },
  });
  return rows;
}

/** Filter klines by date range (inclusive). */
export function filterByRange(data: KlineRow[], startMs: number, endMs: number): KlineRow[] {
  return data.filter(r => r.open_time_ms >= startMs && r.open_time_ms <= endMs);
}
