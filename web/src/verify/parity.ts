/**
 * Parity check runner for comparing Registry TypeScript computations with DuckDB SQL results.
 *
 * Rules:
 * - Compares per tolerance: |a - b| <= max(abs, rel * max(|a|, |b|))
 * - Handles scalar, grouped, matrix, and series kinds
 * - Summary-only parity for histogram (n, min, max per PLAN-verify.md §5)
 */

import type { KlineRow, Meta, QualityReport } from '../types';
import { getMetricDef, type MetricDef, type Result } from './registry';
import { executeQuery } from './engine';

export type ParityStatus = 'unchecked' | 'match' | 'mismatch' | 'error';

export interface ParityItemDiff {
  key: string | number;
  appValue: any;
  sqlValue: any;
  diff: number;
  match: boolean;
}

export interface ParityCheckResult {
  defId: string;
  status: 'match' | 'mismatch' | 'error';
  matchedCount: number;
  totalCount: number;
  maxDelta: number;
  details: ParityItemDiff[];
  error?: string;
  sql: string;
  durationMs: number;
}

/**
 * Checks whether two numeric values are within tolerance.
 */
export function isWithinTolerance(
  valA: number | null | undefined,
  valB: number | null | undefined,
  tolerance: { rel: number; abs: number }
): { match: boolean; diff: number } {
  if (valA === null || valA === undefined || isNaN(Number(valA))) {
    const isBNull = valB === null || valB === undefined || isNaN(Number(valB));
    return { match: isBNull, diff: isBNull ? 0 : Infinity };
  }
  if (valB === null || valB === undefined || isNaN(Number(valB))) {
    return { match: false, diff: Infinity };
  }

  const numA = Number(valA);
  const numB = Number(valB);
  const diff = Math.abs(numA - numB);

  const maxVal = Math.max(Math.abs(numA), Math.abs(numB));
  const maxAllowed = Math.max(tolerance.abs, tolerance.rel * maxVal);

  const match = diff <= maxAllowed;
  return { match, diff };
}

/**
 * Compares app computation result with SQL result rows.
 */
export function compareAppAndSqlResults(
  def: MetricDef,
  appResult: Result,
  sqlRows: Array<Record<string, any>>
): { matchedCount: number; totalCount: number; maxDelta: number; details: ParityItemDiff[]; status: 'match' | 'mismatch' } {
  const tolerance = def.tolerance;
  const details: ParityItemDiff[] = [];
  let matchedCount = 0;
  let totalCount = 0;
  let maxDelta = 0;

  if (def.id === 'volatility.histogram') {
    // Summary-only parity per PLAN-verify.md §5: n, min, max
    const sqlRow = sqlRows[0] ?? {};
    const trace = (appResult as any).trace ?? {};
    const totalBars = (appResult as any).keys?.reduce((acc: number, k: any) => acc + k.n, 0) ?? 0;

    const checks = [
      { key: 'n', app: totalBars, sql: Number(sqlRow.n) },
      { key: 'min', app: Number(trace.min_bps), sql: Number(sqlRow.min) },
      { key: 'max', app: Number(trace.max_bps), sql: Number(sqlRow.max) },
    ];

    for (const c of checks) {
      totalCount++;
      const { match, diff } = isWithinTolerance(c.app, c.sql, tolerance);
      if (diff < Infinity && diff > maxDelta) maxDelta = diff;
      if (match) matchedCount++;
      details.push({
        key: c.key,
        appValue: c.app,
        sqlValue: c.sql,
        diff,
        match,
      });
    }

    return {
      matchedCount,
      totalCount,
      maxDelta,
      details,
      status: matchedCount === totalCount ? 'match' : 'mismatch',
    };
  }

  if (appResult.kind === 'scalar') {
    totalCount = 1;
    const sqlVal = sqlRows[0] ? (sqlRows[0].value ?? Object.values(sqlRows[0])[0]) : null;
    const { match, diff } = isWithinTolerance(appResult.value as number, sqlVal, tolerance);
    if (diff < Infinity) maxDelta = diff;
    if (match) matchedCount = 1;
    details.push({
      key: 'value',
      appValue: appResult.value,
      sqlValue: sqlVal,
      diff,
      match,
    });
  } else if (appResult.kind === 'grouped' || appResult.kind === 'matrix') {
    // Map SQL rows by key
    const sqlMap = new Map<string, number | null>();
    for (const row of sqlRows) {
      const k = String(row.key ?? row.bucket ?? `${row.dow}:${row.hour}`);
      const val = row.value ?? Object.values(row)[0];
      sqlMap.set(k, val !== null && val !== undefined ? Number(val) : null);
    }

    const appKeys = (appResult as any).keys as Array<{ key: string | number; value: any }>;
    totalCount = appKeys.length;

    for (const item of appKeys) {
      const kStr = String(item.key);
      const sqlVal = sqlMap.get(kStr);
      const { match, diff } = isWithinTolerance(item.value, sqlVal, tolerance);
      if (diff < Infinity && diff > maxDelta) maxDelta = diff;
      if (match) matchedCount++;
      details.push({
        key: item.key,
        appValue: item.value,
        sqlValue: sqlVal,
        diff,
        match,
      });
    }
  } else if (appResult.kind === 'series') {
    // Compare timeMs to timeMs points
    const sqlMap = new Map<number, number>();
    for (const row of sqlRows) {
      const t = Number(row.timeMs ?? row.open_time_ms);
      const v = Number(row.value);
      sqlMap.set(t, v);
    }

    const appPoints = appResult.points;
    totalCount = appPoints.length;

    for (const pt of appPoints) {
      const sqlVal = sqlMap.get(pt.timeMs);
      const { match, diff } = isWithinTolerance(pt.value, sqlVal, tolerance);
      if (diff < Infinity && diff > maxDelta) maxDelta = diff;
      if (match) matchedCount++;
      details.push({
        key: pt.timeMs,
        appValue: pt.value,
        sqlValue: sqlVal,
        diff,
        match,
      });
    }
  }

  const status = matchedCount === totalCount && totalCount > 0 ? 'match' : 'mismatch';
  return { matchedCount, totalCount, maxDelta, details, status };
}

/**
 * Runs a cross-check verification for a metric definition using live DuckDB-WASM engine.
 */
export async function runParityCheck(
  defId: string,
  rows: KlineRow[],
  params?: Record<string, any>,
  context?: { meta?: Meta | null; qualityData?: QualityReport | null }
): Promise<ParityCheckResult> {
  const def = getMetricDef(defId);
  if (!def) {
    return {
      defId,
      status: 'error',
      matchedCount: 0,
      totalCount: 0,
      maxDelta: 0,
      details: [],
      error: `Definition '${defId}' not found in registry.`,
      sql: '',
      durationMs: 0,
    };
  }

  if (def.kind === 'provenance' || !def.sql) {
    return {
      defId,
      status: 'error',
      matchedCount: 0,
      totalCount: 0,
      maxDelta: 0,
      details: [],
      error: `Definition '${defId}' has kind '${def.kind}' and does not support SQL cross-checks.`,
      sql: '',
      durationMs: 0,
    };
  }

  const sql = def.sql(params ?? {});
  const startTime = performance.now();

  try {
    const appResult = def.compute(rows, params, context);
    const queryRes = await executeQuery(sql, { releaseId: context?.meta?.release_id });
    const durationMs = performance.now() - startTime;

    const comp = compareAppAndSqlResults(def, appResult, queryRes.rows);

    return {
      defId,
      status: comp.status,
      matchedCount: comp.matchedCount,
      totalCount: comp.totalCount,
      maxDelta: comp.maxDelta,
      details: comp.details,
      sql,
      durationMs,
    };
  } catch (err: any) {
    return {
      defId,
      status: 'error',
      matchedCount: 0,
      totalCount: 0,
      maxDelta: 0,
      details: [],
      error: err?.message || String(err),
      sql,
      durationMs: performance.now() - startTime,
    };
  }
}
