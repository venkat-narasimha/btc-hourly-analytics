/**
 * Data loading module.
 * Fetches meta.json + quality_report.json + parquet via hyparquet.
 * Browser NEVER fetches from Binance at runtime.
 */

import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet';
import type { KlineRow, Meta, QualityReport } from '../types';

const DATA_BASE = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/data/current`;

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
  const rawRows = await parquetReadObjects({ file });
  return rawRows.map((r: any) => ({
    open_time_ms: Number(r.open_time_ms),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    quote_volume: Number(r.quote_volume),
    trades: Number(r.trades),
    taker_buy_volume: Number(r.taker_buy_volume),
    taker_buy_quote_volume: Number(r.taker_buy_quote_volume),
    log_ret: r.log_ret !== null && r.log_ret !== undefined ? Number(r.log_ret) : null,
    hour: Number(r.hour),
    dow: Number(r.dow),
    taker_buy_ratio: r.taker_buy_ratio !== null && r.taker_buy_ratio !== undefined ? Number(r.taker_buy_ratio) : null,
    hl_range: Number(r.hl_range),
  }));
}

/** Filter klines by date range (inclusive). */
export function filterByRange(data: KlineRow[], startMs: number, endMs: number): KlineRow[] {
  return data.filter(r => r.open_time_ms >= startMs && r.open_time_ms <= endMs);
}
