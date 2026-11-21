/**
 * Pure instance selector module for Validation Tables.
 * Extracts the exact subset of KlineRow[] instances behind any aggregate row, bucket, or series point.
 */

import type { KlineRow } from '../types';

export interface InstanceScope {
  domain: string;
  defId?: string;
  bucketType?: 'hour' | 'dow';
  bucketValue?: number;
  cellKey?: string; // e.g. "0:14" for Mon 14:00
  yearMonth?: string; // e.g. "2024-03"
  year?: number;
  openTimeMs?: number;
  window?: number;
  binRange?: [number, number]; // [min, max]
  isLastBin?: boolean;
  gapStartMs?: number;
  gapEndMs?: number;
}

/**
 * Returns the exact KlineRow[] instances scoped to the requested aggregate row.
 */
export function selectInstances(rows: KlineRow[], scope: InstanceScope): KlineRow[] {
  if (!rows || rows.length === 0) return [];

  const {
    domain,
    defId,
    bucketType,
    bucketValue,
    cellKey,
    yearMonth,
    year,
    openTimeMs,
    window,
    binRange,
  } = scope;

  // 1. Raw Data: single bar if openTimeMs given, else all rows
  if (domain === 'raw') {
    if (openTimeMs !== undefined) {
      return rows.filter((r) => r.open_time_ms === openTimeMs);
    }
    return rows;
  }

  // 2. Seasonality domain: filter by bucket (hour 0-23 or dow 0-6)
  if (domain === 'seasonality' || bucketType !== undefined) {
    if (bucketType === 'hour' && bucketValue !== undefined) {
      return rows.filter((r) => r.hour === bucketValue);
    }
    if (bucketType === 'dow' && bucketValue !== undefined) {
      return rows.filter((r) => r.dow === bucketValue);
    }
  }

  // 3. Heatmap domain: filter by cell key "dow:hour"
  if (domain === 'heatmap' || cellKey !== undefined) {
    if (cellKey) {
      const parts = cellKey.split(':');
      if (parts.length === 2) {
        const d = Number(parts[0]);
        const h = Number(parts[1]);
        return rows.filter((r) => r.dow === d && r.hour === h);
      }
    }
  }

  // 4. Calendar domain
  if (domain === 'calendar') {
    if (yearMonth) {
      const [yStr, mStr] = yearMonth.split('-');
      const y = Number(yStr);
      const m = Number(mStr) - 1; // 0-indexed month
      return rows.filter((r) => {
        const d = new Date(r.open_time_ms);
        return d.getUTCFullYear() === y && d.getUTCMonth() === m;
      });
    }
    if (year !== undefined) {
      return rows.filter((r) => new Date(r.open_time_ms).getUTCFullYear() === year);
    }
    if (openTimeMs !== undefined) {
      return rows.filter((r) => r.open_time_ms <= openTimeMs);
    }
  }

  // 5. Volatility domain
  if (domain === 'volatility') {
    if (binRange) {
      const [minVal, maxVal] = binRange;
      const isLast = scope.isLastBin ?? false;
      return rows.filter((r) => {
        if (r.log_ret === null || r.log_ret === undefined) return false;
        const val = Math.abs(minVal) > 1 || Math.abs(maxVal) > 1 ? r.log_ret * 10000 : r.log_ret;
        if (isLast) {
          return val >= minVal && val <= maxVal;
        }
        return val >= minVal && val < maxVal;
      });
    }
    if (window !== undefined && openTimeMs !== undefined) {
      const idx = rows.findIndex((r) => r.open_time_ms === openTimeMs);
      if (idx !== -1) {
        const startIdx = Math.max(0, idx - window + 1);
        return rows.slice(startIdx, idx + 1);
      }
    }
    // Distribution stats use all valid returns
    return rows.filter((r) => r.log_ret !== null && r.log_ret !== undefined);
  }

  // 6. Flow domain
  if (domain === 'flow') {
    if (bucketValue !== undefined) {
      return rows.filter((r) => r.hour === bucketValue);
    }
    if (openTimeMs !== undefined) {
      return rows.filter((r) => r.open_time_ms === openTimeMs);
    }
  }

  // 7. Quality domain
  if (domain === 'quality') {
    if (scope.gapStartMs !== undefined && scope.gapEndMs !== undefined) {
      // Return surrounding context bars: last bar before gapStart, first bar after gapEnd
      const before = rows.filter((r) => r.open_time_ms < scope.gapStartMs!).slice(-1)[0];
      const after = rows.find((r) => r.open_time_ms > scope.gapEndMs!);
      const result: KlineRow[] = [];
      if (before) result.push(before);
      if (after) result.push(after);
      return result;
    }
    if (year !== undefined) {
      return rows.filter((r) => new Date(r.open_time_ms).getUTCFullYear() === year);
    }
  }

  // 7. KPIs domain & default handling
  if (defId) {
    if (defId === 'kpi.latest_close') {
      return rows.length > 0 ? [rows[rows.length - 1]] : [];
    }
    if (defId === 'kpi.period_return_pct') {
      return rows.length > 1 ? [rows[0], rows[rows.length - 1]] : rows;
    }
    if (defId === 'kpi.best_hour' || defId === 'kpi.worst_hour') {
      if (bucketValue !== undefined) {
        return rows.filter((r) => r.hour === bucketValue);
      }
    }
    if (defId === 'kpi.best_dow' || defId === 'kpi.worst_dow') {
      if (bucketValue !== undefined) {
        return rows.filter((r) => r.dow === bucketValue);
      }
    }
    if (defId === 'kpi.hourly_win_rate' || defId === 'kpi.mean_hourly_return') {
      return rows.filter((r) => r.log_ret !== null);
    }
    if (year !== undefined) {
      return rows.filter((r) => new Date(r.open_time_ms).getUTCFullYear() === year);
    }
  }

  // If single openTimeMs specified
  if (openTimeMs !== undefined) {
    return rows.filter((r) => r.open_time_ms === openTimeMs);
  }

  return rows;
}
