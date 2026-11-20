/**
 * Vitest tests for the Data Quality UI component and freshness badge.
 */

import { describe, it, expect } from 'vitest';
import { renderQualityReport } from './quality';
import type { Meta, QualityReport } from '../types';

const baseMeta: Meta = {
  schema_version: '1.0',
  symbol: 'BTCUSDT',
  market: 'um',
  interval: '1h',
  first_open_ms: 1577836800000,
  last_open_ms: Date.now() - 10 * 3600 * 1000, // 10 hours old (fresh)
  freshness_hours: 10.0,
  rows: 60000,
  generated_at_utc: '2026-11-20T00:00:00Z',
  pipeline_git_sha: 'abcdef123',
  release_id: '20261120T000000Z',
  files_downloaded: { monthly: 80, daily: 15 },
  source_base_url: 'https://data.binance.vision',
};

const baseReport: QualityReport = {
  expected_hours: 60000,
  actual_rows: 59980,
  coverage_pct: 99.97,
  missing_ranges: [],
  duplicates_removed: 12,
  quarantined_rows: [],
  zero_volume_bars: 5,
  files_ms: 95,
  files_us: 0,
  header_files: 0,
  per_year_row_counts: { '2024': 8784 },
  checksums_verified: 95,
  warnings: [],
};

describe('renderQualityReport freshness badge', () => {
  it('renders warning badge when meta is 3 days old (>48h)', () => {
    const container = { innerHTML: '' } as unknown as HTMLElement;
    const staleMeta: Meta = {
      ...baseMeta,
      last_open_ms: Date.now() - 3 * 24 * 3600 * 1000, // 72 hours old
      freshness_hours: 72.0,
    };

    renderQualityReport(container, staleMeta, baseReport);

    expect(container.innerHTML).toContain('badge-warning');
    expect(container.innerHTML).toContain('Stale Data');
    expect(container.innerHTML).toContain('Warning: >48h stale');
  });

  it('renders positive badge when meta is fresh (<=48h)', () => {
    const container = { innerHTML: '' } as unknown as HTMLElement;
    const freshMeta: Meta = {
      ...baseMeta,
      last_open_ms: Date.now() - 12 * 3600 * 1000, // 12 hours old
      freshness_hours: 12.0,
    };

    renderQualityReport(container, freshMeta, baseReport);

    expect(container.innerHTML).toContain('badge-positive');
    expect(container.innerHTML).toContain('Fresh Data');
    expect(container.innerHTML).toContain('Operational normal 4.5–28.5h');
  });

  it('derives violations and checksums rows dynamically from report data', () => {
    const container = { innerHTML: '' } as unknown as HTMLElement;
    const reportWithViolations: QualityReport = {
      ...baseReport,
      checksums_verified: 95,
      quarantined_rows: [
        { reason: 'open <= 0', count: 3 },
        { reason: 'high < low', count: 2 },
      ],
    };

    renderQualityReport(container, baseMeta, reportWithViolations);

    // 80 monthly + 15 daily = 95 total
    expect(container.innerHTML).toContain('95 / 95 matched (100%)');
    // 3 + 2 = 5 violations
    expect(container.innerHTML).toContain('5 violations detected');
    // Dedupe tooltip mentions daily wins over monthly on conflict
    expect(container.innerHTML).toContain('preferring daily archive slices over monthly files on conflict');
  });
});
