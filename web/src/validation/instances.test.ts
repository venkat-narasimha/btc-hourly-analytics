import { describe, it, expect } from 'vitest';
import { selectInstances } from './instances';
import type { KlineRow } from '../types';

function createMockRows(): KlineRow[] {
  const rows: KlineRow[] = [];
  const startMs = Date.UTC(2024, 0, 1, 0, 0, 0); // 2024-01-01 00:00:00 (Monday)
  for (let i = 0; i < 48; i++) {
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
      dow: (d.getUTCDay() + 6) % 7, // Mon = 0
      taker_buy_ratio: 0.5,
      hl_range: 0.0025,
    });
  }
  return rows;
}

describe('Instance Selectors (instances.ts)', () => {
  const rows = createMockRows();

  it('selects single bar for raw data when openTimeMs is specified', () => {
    const t = rows[5].open_time_ms;
    const instances = selectInstances(rows, { domain: 'raw', openTimeMs: t });
    expect(instances.length).toBe(1);
    expect(instances[0].open_time_ms).toBe(t);
  });

  it('selects all rows for raw data when openTimeMs is not specified', () => {
    const instances = selectInstances(rows, { domain: 'raw' });
    expect(instances.length).toBe(48);
  });

  it('selects seasonality instances by hour bucket', () => {
    const instances = selectInstances(rows, { domain: 'seasonality', bucketType: 'hour', bucketValue: 14 });
    expect(instances.length).toBe(2); // 48h has two hour 14s
    for (const r of instances) {
      expect(r.hour).toBe(14);
    }
  });

  it('selects seasonality instances by dow bucket', () => {
    const instances = selectInstances(rows, { domain: 'seasonality', bucketType: 'dow', bucketValue: 0 });
    expect(instances.length).toBe(24); // Day 0 (Monday) has 24 hours
    for (const r of instances) {
      expect(r.dow).toBe(0);
    }
  });

  it('selects heatmap cell instances by dow:hour key', () => {
    const instances = selectInstances(rows, { domain: 'heatmap', cellKey: '0:14' });
    expect(instances.length).toBe(1);
    expect(instances[0].dow).toBe(0);
    expect(instances[0].hour).toBe(14);
  });

  it('selects latest_close as single latest bar', () => {
    const instances = selectInstances(rows, { domain: 'kpis', defId: 'kpi.latest_close' });
    expect(instances.length).toBe(1);
    expect(instances[0].open_time_ms).toBe(rows[rows.length - 1].open_time_ms);
  });

  it('selects period_return_pct as [first, last] bars', () => {
    const instances = selectInstances(rows, { domain: 'kpis', defId: 'kpi.period_return_pct' });
    expect(instances.length).toBe(2);
    expect(instances[0].open_time_ms).toBe(rows[0].open_time_ms);
    expect(instances[1].open_time_ms).toBe(rows[rows.length - 1].open_time_ms);
  });
});
