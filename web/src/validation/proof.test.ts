import { describe, it, expect } from 'vitest';
import { generatePlainLanguageProof, recomputeFromInstances } from './proof';
import { getMetricDef } from '../verify/registry';
import type { KlineRow } from '../types';

function createMockRows(): KlineRow[] {
  const rows: KlineRow[] = [];
  const startMs = Date.UTC(2024, 0, 1, 0, 0, 0);
  for (let i = 0; i < 24; i++) {
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

describe('Proof Engine (proof.ts)', () => {
  const rows = createMockRows();

  it('generates clear plain-language proof description', () => {
    const def = getMetricDef('kpi.total_bars')!;
    const proof = generatePlainLanguageProof({
      def,
      displayedValue: 24,
      instances: rows,
    });

    expect(proof).toContain('24 hourly observations');
    expect(proof).toContain('2024-01-01 00:00 UTC');
    expect(proof).toContain('N = Total Hourly Observations');
  });

  it('recomputes scalar KPI from instances and reports match', () => {
    const def = getMetricDef('kpi.total_bars')!;
    const result = recomputeFromInstances({
      def,
      displayedValue: 24,
      instances: rows,
    });

    expect(result.isMatch).toBe(true);
    expect(result.recomputedValue).toBe(24);
    expect(result.message).toContain('✓ matches');
  });

  it('detects tolerance mismatch when displayed value differs', () => {
    const def = getMetricDef('kpi.total_bars')!;
    const result = recomputeFromInstances({
      def,
      displayedValue: 999, // deliberate mismatch
      instances: rows,
    });

    expect(result.isMatch).toBe(false);
    expect(result.delta).toBe(975);
    expect(result.message).toContain('✗ differs');
  });
});
