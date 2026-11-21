/**
 * Display and formatting helper functions.
 */

/**
 * Format basis points with explicit conditional '+' for positive values and no "+-" for negative values.
 * e.g. 2.1 -> "+2.1 bps", -2.1 -> "-2.1 bps", 0 -> "0.0 bps"
 */
export function formatSignedBps(val: number): string {
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(1)} bps`;
}

/**
 * Compute dynamic padded axis bounds for Hourly Taker Buy Ratio (in %).
 * Expands based on data min/max with padding, but always includes 50% so the baseline is visible.
 */
export function computeTbrAxisBounds(values: number[]): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 45, max: 55 };
  }
  let min = Math.min(...values);
  let max = Math.max(...values);

  // Always include 50% baseline
  min = Math.min(min, 50);
  max = Math.max(max, 50);

  // Padding of at least 1% or 15% of span
  const span = max - min;
  const pad = Math.max(span * 0.15, 1);

  return {
    min: Math.floor(min - pad),
    max: Math.ceil(max + pad),
  };
}

/**
 * Abbreviate large numeric volumes (e.g. 32060000 -> "32.06M", 1240000000 -> "1.24B", 450200 -> "450.2K").
 */
export function formatVolumeAbbreviated(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e9) {
    return `${sign}${(abs / 1e9).toFixed(2)}B`;
  }
  if (abs >= 1e6) {
    return `${sign}${(abs / 1e6).toFixed(2)}M`;
  }
  if (abs >= 1e3) {
    return `${sign}${(abs / 1e3).toFixed(1)}K`;
  }
  return `${sign}${abs.toFixed(1)}`;
}

