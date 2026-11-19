/** Global type definitions for the application. */

/** A single BTCUSDT 1h kline row from the parquet file. */
export interface KlineRow {
  open_time_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quote_volume: number;
  trades: number;
  taker_buy_volume: number;
  taker_buy_quote_volume: number;
  log_ret: number | null;
  hour: number;
  dow: number;
  taker_buy_ratio: number | null;
  hl_range: number;
}

/** meta.json structure */
export interface Meta {
  schema_version: string;
  symbol: string;
  market: string;
  interval: string;
  first_open_ms: number;
  last_open_ms: number;
  rows: number;
  generated_at_utc: string;
  pipeline_git_sha: string;
  release_id: string;
  files_downloaded: { monthly: number; daily: number };
  source_base_url: string;
}

/** quality_report.json structure */
export interface QualityReport {
  expected_hours: number;
  actual_rows: number;
  coverage_pct: number;
  missing_ranges: Array<{ start_ms: number; end_ms: number; hours: number }>;
  duplicates_removed: number;
  quarantined_rows: Array<{ reason: string; count: number }>;
  zero_volume_bars: number;
  files_ms: number;
  files_us: number;
  header_files: number;
  per_year_row_counts: Record<string, number>;
  checksums_verified: number;
  warnings: string[];
}

/** Date range filter state */
export interface DateRange {
  startMs: number;
  endMs: number;
}

/** Seasonality metric options */
export type SeasonalityMetric =
  | 'mean_return'
  | 'volatility'
  | 'win_rate'
  | 'total_volume'
  | 'taker_buy_ratio'
  | 'mean_hl_range';

/** Tab identifiers */
export type TabId = 'price' | 'seasonality' | 'quality' | 'heatmap' | 'volatility' | 'flow' | 'calendar';
