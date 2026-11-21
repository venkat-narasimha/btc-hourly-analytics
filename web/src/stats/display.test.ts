/**
 * Tests for display helper functions (formatSignedBps, computeTbrAxisBounds).
 */

import { describe, it, expect } from 'vitest';
import { formatSignedBps, computeTbrAxisBounds, formatVolumeAbbreviated } from './display';

describe('formatSignedBps', () => {
  it('formats positive numbers with a + sign', () => {
    expect(formatSignedBps(2.1)).toBe('+2.1 bps');
    expect(formatSignedBps(15.42)).toBe('+15.4 bps');
  });

  it('formats negative numbers with a single - sign (no +-) even under bearish filter', () => {
    expect(formatSignedBps(-2.1)).toBe('-2.1 bps');
    expect(formatSignedBps(-0.1)).toBe('-0.1 bps');
  });

  it('formats zero without a sign', () => {
    expect(formatSignedBps(0)).toBe('0.0 bps');
  });
});

describe('computeTbrAxisBounds', () => {
  it('returns default 45–55 when values array is empty', () => {
    expect(computeTbrAxisBounds([])).toEqual({ min: 45, max: 55 });
  });

  it('always includes 50 even when data is entirely above 50', () => {
    // Bullish period: all TBR between 54% and 58%
    const bounds = computeTbrAxisBounds([54, 56, 58]);
    expect(bounds.min).toBeLessThanOrEqual(50);
    expect(bounds.max).toBeGreaterThanOrEqual(58);
  });

  it('always includes 50 even when data is entirely below 50', () => {
    // Bearish period: all TBR between 40% and 44%
    const bounds = computeTbrAxisBounds([40, 42, 44]);
    expect(bounds.min).toBeLessThanOrEqual(40);
    expect(bounds.max).toBeGreaterThanOrEqual(50);
  });

  it('pads wide extremes without clipping', () => {
    // Extreme range: 35% to 65%
    const bounds = computeTbrAxisBounds([35, 50, 65]);
    expect(bounds.min).toBeLessThan(35);
    expect(bounds.max).toBeGreaterThan(65);
    expect(bounds.min).toBeLessThanOrEqual(50);
    expect(bounds.max).toBeGreaterThanOrEqual(50);
  });
});

describe('formatVolumeAbbreviated', () => {
  it('formats billions correctly', () => {
    expect(formatVolumeAbbreviated(1240000000)).toBe('1.24B');
    expect(formatVolumeAbbreviated(3500000000)).toBe('3.50B');
  });

  it('formats millions correctly', () => {
    expect(formatVolumeAbbreviated(32060000)).toBe('32.06M');
    expect(formatVolumeAbbreviated(1500000)).toBe('1.50M');
  });

  it('formats thousands correctly', () => {
    expect(formatVolumeAbbreviated(450200)).toBe('450.2K');
    expect(formatVolumeAbbreviated(1200)).toBe('1.2K');
  });

  it('formats sub-thousand values correctly', () => {
    expect(formatVolumeAbbreviated(450.2)).toBe('450.2');
  });

  it('handles negative numbers cleanly', () => {
    expect(formatVolumeAbbreviated(-32060000)).toBe('-32.06M');
  });

  it('handles null and undefined gracefully', () => {
    expect(formatVolumeAbbreviated(null)).toBe('—');
    expect(formatVolumeAbbreviated(undefined)).toBe('—');
  });
});

