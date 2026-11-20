import { describe, it, expect } from 'vitest';
import {
  formatTargetLabel,
  generateSubsetCsv,
  getScopedSubset,
  renderInspectDrawerHtml,
} from './drawer';
import type { KlineRow, Meta, QualityReport } from '../types';

function createMockRows(count = 20): KlineRow[] {
  const rows: KlineRow[] = [];
  const startMs = 1704067200000; // 2024-01-01 00:00:00 UTC (Monday)
  for (let i = 0; i < count; i++) {
    const t = startMs + i * 3600000;
    const d = new Date(t);
    rows.push({
      open_time_ms: t,
      open: 40000 + i * 10,
      high: 40050 + i * 10,
      low: 39950 + i * 10,
      close: 40020 + i * 10,
      volume: 100 + i,
      quote_volume: (100 + i) * 40000,
      trades: 500,
      taker_buy_volume: 50 + i,
      taker_buy_quote_volume: (50 + i) * 40000,
      log_ret: i === 0 ? null : 0.0005,
      hour: d.getUTCHours(),
      dow: (d.getUTCDay() + 6) % 7,
      taker_buy_ratio: 0.5,
      hl_range: 0.0025,
    });
  }
  return rows;
}

const mockMeta: Meta = {
  schema_version: '1.0',
  symbol: 'BTCUSDT',
  interval: '1h',
  market: 'futures',
  first_open_ms: 1704067200000,
  last_open_ms: 1704067200000 + 20 * 3600000,
  rows: 20,
  release_id: 'release-2024-01',
  pipeline_git_sha: 'testsha123',
  generated_at_utc: '2024-01-02T00:00:00Z',
  files_downloaded: { monthly: 1, daily: 1 },
  source_base_url: 'https://data.binance.vision',
};

const mockQuality: QualityReport = {
  actual_rows: 20,
  expected_hours: 20,
  coverage_pct: 100.0,
  missing_ranges: [],
  per_year_row_counts: { '2024': 20 },
  checksums_verified: 2,
  duplicates_removed: 0,
  zero_volume_bars: 0,
  files_ms: 2,
  files_us: 0,
  header_files: 0,
  quarantined_rows: [],
  warnings: [],
};

describe('Inspect Drawer (Phase A)', () => {
  it('formats target labels correctly for all scoped types', () => {
    expect(formatTargetLabel('0:14')).toContain('Monday 14:00 UTC');
    expect(formatTargetLabel('2024-03')).toContain('March 2024');
    expect(formatTargetLabel('2024')).toContain('Year 2024 (YTD)');
    expect(formatTargetLabel('5', 'hour')).toBe('Hour 05:00 UTC');
    expect(formatTargetLabel('2', 'dow')).toContain('Wednesday');
  });

  it('filters scoped subsets accurately', () => {
    const rows = createMockRows(24);
    // Hour filter
    const hour5 = getScopedSubset(rows, '5', 'hour');
    expect(hour5.length).toBe(1);
    expect(hour5[0].hour).toBe(5);

    // Heatmap filter (Monday hour 5)
    const heat5 = getScopedSubset(rows, '0:5');
    expect(heat5.length).toBe(1);
    expect(heat5[0].dow).toBe(0);
    expect(heat5[0].hour).toBe(5);

    // Unscoped
    const all = getScopedSubset(rows, undefined);
    expect(all.length).toBe(24);
  });

  it('generates deterministic RFC4180 CSV with 15 columns and nulls as empty string', () => {
    const rows = createMockRows(3);
    const csv = generateSubsetCsv(rows);

    const lines = csv.trim().split('\r\n');
    expect(lines.length).toBe(4); // 1 header + 3 rows

    const headers = lines[0].split(',');
    expect(headers).toEqual([
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
    ]);

    // Row 0 has null log_ret, should be empty string
    const row0 = lines[1].split(',');
    expect(row0[10]).toBe(''); // log_ret is empty string

    // Row 1 has 0.0005 log_ret
    const row1 = lines[2].split(',');
    expect(row1[10]).toBe('0.0005');
  });

  it('renders all 6 sections and data table in HTML', () => {
    const rows = createMockRows(10);
    const html = renderInspectDrawerHtml({
      defId: 'kpi.total_bars',
      data: rows,
      meta: mockMeta,
      qualityData: mockQuality,
    });

    expect(html).toContain('1. Mathematical Definition');
    expect(html).toContain('2. Scope &amp; Inputs');
    expect(html).toContain('3. Computation Trace Intermediates');
    expect(html).toContain('4. Exact Underlying Observations');
    expect(html).toContain('5. Data Provenance &amp; Lineage');
    expect(html).toContain('6. Audit Actions');
    expect(html).toContain('N = Total Hourly Observations');
    expect(html).toContain('Download Subset CSV');
    expect(html).toContain('Recompute Live (Wiring Check)');
    expect(html).toContain('Copy Proof Link');
  });

  it('displays non-blocking release mismatch warning banner when proofReleaseId differs', () => {
    const rows = createMockRows(5);
    const html = renderInspectDrawerHtml({
      defId: 'kpi.total_bars',
      data: rows,
      meta: mockMeta,
      qualityData: mockQuality,
      proofReleaseId: 'different-release-999',
    });

    expect(html).toContain('drawer-notice-warning');
    expect(html).toContain('different-release-999');
    expect(html).toContain(mockMeta.release_id);
  });
});
