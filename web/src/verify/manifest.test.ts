import { describe, it, expect } from 'vitest';
import type { KlineRow, Meta, QualityReport } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { parquetReadObjects } from 'hyparquet';
import {
  computeBufferSha256,
  formatExpectedResult,
  generateManifest,
} from './manifest';

describe('manifest', () => {
  it('computes sha256 buffer correctly', async () => {
    const data = new TextEncoder().encode('hello world');
    const sha = await computeBufferSha256(data);
    // sha256('hello world') = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(sha).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('formats scalar, grouped, series, and provenance results', () => {
    const scalarRes = {
      kind: 'scalar' as const,
      value: 123.45,
      n: 100,
      trace: {},
    };
    expect(formatExpectedResult(scalarRes)).toEqual({ value: 123.45, n: 100 });

    const groupedRes = {
      kind: 'grouped' as const,
      keys: [
        { key: 0, value: 10, n: 5 },
        { key: 1, value: 20, n: 5 },
      ],
      trace: {},
    };
    expect(formatExpectedResult(groupedRes)).toEqual({
      keys: [
        { key: 0, value: 10, n: 5 },
        { key: 1, value: 20, n: 5 },
      ],
      n: 10,
    });

    const seriesRes = {
      kind: 'series' as const,
      points: [],
      summary: { n: 50, min: 1, max: 10, mean: 5.5 },
      trace: {},
    };
    expect(formatExpectedResult(seriesRes)).toEqual({
      n: 50,
      min: 1,
      max: 10,
      mean: 5.5,
    });

    const provRes = {
      kind: 'provenance' as const,
      report: { coverage_pct: 99.8 },
      sources: [],
      trace: {},
    };
    expect(formatExpectedResult(provRes)).toEqual({
      report: { coverage_pct: 99.8 },
    });
  });

  it('generates a full verification manifest with all definitions and scope', async () => {
    const mockRows: KlineRow[] = [
      {
        open_time_ms: 1700000000000,
        open: 36000,
        high: 36200,
        low: 35900,
        close: 36100,
        volume: 100,
        quote_volume: 3610000,
        trades: 500,
        taker_buy_volume: 55,
        taker_buy_quote_volume: 1985500,
        log_ret: null,
        hour: 0,
        dow: 0,
        taker_buy_ratio: 0.55,
        hl_range: 0.00833,
      },
      {
        open_time_ms: 1700003600000,
        open: 36100,
        high: 36300,
        low: 36050,
        close: 36250,
        volume: 120,
        quote_volume: 4350000,
        trades: 600,
        taker_buy_volume: 70,
        taker_buy_quote_volume: 2537500,
        log_ret: Math.log(36250 / 36100),
        hour: 1,
        dow: 0,
        taker_buy_ratio: 0.5833,
        hl_range: 0.006925,
      },
    ];

    const mockMeta: Meta = {
      schema_version: '1.0',
      symbol: 'BTCUSDT',
      market: 'usdt_futures',
      interval: '1h',
      first_open_ms: 1700000000000,
      last_open_ms: 1700003600000,
      rows: 2,
      generated_at_utc: '2024-01-01T00:00:00Z',
      pipeline_git_sha: 'testsha1234',
      release_id: 'test_rel_01',
      artifact_sha256: 'fedcba9876543210',
      source_files: [
        { url: 'http://fake/m1.zip', sha256: 'sha1', kind: 'monthly' },
      ],
      files_downloaded: { monthly: 1, daily: 0 },
      source_base_url: 'https://data.binance.vision',
    };

    const mockQuality: QualityReport = {
      expected_hours: 2,
      actual_rows: 2,
      coverage_pct: 100,
      missing_ranges: [],
      duplicates_removed: 0,
      quarantined_rows: [],
      zero_volume_bars: 0,
      files_ms: 1,
      files_us: 0,
      header_files: 1,
      per_year_row_counts: { '2023': 2 },
      checksums_verified: 1,
      warnings: [],
    };

    const manifest = await generateManifest(mockRows, mockMeta, mockQuality);

    expect(manifest.schema_version).toBe('1.0');
    expect(manifest.release_id).toBe('test_rel_01');
    expect(manifest.pipeline_git_sha).toBe('testsha1234');
    expect(manifest.scope.total_bars).toBe(2);
    expect(manifest.scope.start_ms).toBe(1700000000000);
    expect(manifest.scope.end_ms).toBe(1700003600000);
    expect(manifest.source_files.length).toBe(1);

    // Should include definitions for all 40 registered metrics plus dow variations for seasonality
    expect(manifest.definitions.length).toBeGreaterThanOrEqual(40);

    const totalBarsDef = manifest.definitions.find((d) => d.id === 'kpi.total_bars');
    expect(totalBarsDef).toBeDefined();
    expect(totalBarsDef?.expected.value).toBe(2);

    const coverageDef = manifest.definitions.find((d) => d.id === 'kpi.coverage_pct');
    expect(coverageDef).toBeDefined();
    expect(coverageDef?.expected.report.coverage_pct).toBe(100);
  });

  it('generates verification manifest for live release artifact if present', async () => {
    const parquetPath = path.resolve(__dirname, '../../../artifacts/current/btcusdt_1h.parquet');
    const metaPath = path.resolve(__dirname, '../../../artifacts/current/meta.json');
    const qualityPath = path.resolve(__dirname, '../../../artifacts/current/quality_report.json');

    if (!fs.existsSync(parquetPath) || !fs.existsSync(metaPath)) {
      return;
    }

    const parquetBytes = fs.readFileSync(parquetPath);
    const meta: Meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const quality: QualityReport = fs.existsSync(qualityPath)
      ? JSON.parse(fs.readFileSync(qualityPath, 'utf-8'))
      : null;

    const rawRows = await parquetReadObjects({ file: parquetBytes.buffer });
    const rows: KlineRow[] = rawRows.map((r: any) => ({
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

    const manifest = await generateManifest(rows, meta, quality, parquetBytes);
    expect(manifest.release_id).toBe(meta.release_id);
    expect(manifest.scope.total_bars).toBe(rows.length);
    expect(manifest.artifact_sha256).toBeDefined();
    expect(manifest.artifact_sha256.length).toBe(64);

    // Save manifest for verification kit live run
    const outPath = path.resolve(__dirname, '../../../artifacts/current/verification_manifest.json');
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf-8');
    expect(fs.existsSync(outPath)).toBe(true);
  });
});
