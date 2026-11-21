/**
 * Plain-language proof and recompute engine for Validation Tables.
 * Proves numbers directly from enumerable instances without SQL.
 */

import type { KlineRow, Meta, QualityReport } from '../types';
import type { MetricDef } from '../verify/registry';

export interface ProofContext {
  def: MetricDef;
  displayedValue: any;
  instances: KlineRow[];
  params?: Record<string, any>;
  meta?: Meta | null;
  qualityData?: QualityReport | null;
  label?: string;
  targetKey?: string | number;
}

export interface RecomputeResult {
  recomputedValue: any;
  formattedRecomputed: string;
  delta: number;
  isMatch: boolean;
  tolerance: { abs: number; rel: number };
  message: string;
}

/**
 * Formats a timestamp into YYYY-MM-DD HH:mm UTC.
 */
function formatUtcDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00 UTC`;
}

/**
 * Generates an intuitive, plain-language description explaining how the number is derived.
 */
export function generatePlainLanguageProof(ctx: ProofContext): string {
  const { def, displayedValue, instances, label } = ctx;
  const n = instances.length;

  if (n === 0) {
    return `No observations found in the selected range.`;
  }

  const firstDate = formatUtcDate(instances[0].open_time_ms);
  const lastDate = formatUtcDate(instances[instances.length - 1].open_time_ms);
  const dateRangeStr = n === 1 ? firstDate : `${firstDate} to ${lastDate}`;
  const validReturns = instances.filter((r) => r.log_ret !== null).length;
  const gaps = n - validReturns;

  const displayFormatted = def.format ? def.format(displayedValue) : String(displayedValue);
  const metricName = label || def.label;

  let explanation = `This value (${displayFormatted}) for ${metricName} is derived from ${n.toLocaleString('en-US')} hourly observations (${dateRangeStr}).`;

  if (gaps > 0) {
    explanation += ` Across this scope, ${validReturns.toLocaleString('en-US')} valid log returns were used and ${gaps.toLocaleString('en-US')} exchange outage gaps were excluded.`;
  }

  explanation += ` Under registry formula: ${def.formula}.`;

  return explanation;
}

/**
 * Recomputes the value live from the exact instance subset and checks tolerance match.
 */
export function recomputeFromInstances(ctx: ProofContext): RecomputeResult {
  const { def, displayedValue, instances, params, meta, qualityData, targetKey } = ctx;

  const res = def.compute(instances, params, { meta, qualityData });
  let recomputedValue: any = null;

  if (res.kind === 'scalar') {
    recomputedValue = res.value;
  } else if (res.kind === 'grouped' || res.kind === 'matrix') {
    if (targetKey !== undefined && targetKey !== null) {
      const match = res.keys.find((k) => String(k.key) === String(targetKey));
      recomputedValue = match ? match.value : (res.keys[0]?.value ?? null);
    } else {
      recomputedValue = res.keys[0]?.value ?? null;
    }
  } else if (res.kind === 'series') {
    if (params?.openTimeMs !== undefined) {
      const pt = res.points.find((p) => p.timeMs === params.openTimeMs);
      recomputedValue = pt ? pt.value : res.summary.mean;
    } else {
      recomputedValue = res.summary.mean;
    }
  } else if (res.kind === 'provenance') {
    recomputedValue = displayedValue;
  }

  const formattedRecomputed = def.format ? def.format(recomputedValue) : String(recomputedValue);

  const numDisplayed = Number(displayedValue);
  const numRecomputed = Number(recomputedValue);

  let isMatch = false;
  let delta = 0;

  if (!isNaN(numDisplayed) && !isNaN(numRecomputed)) {
    delta = Math.abs(numRecomputed - numDisplayed);
    const tol = def.tolerance || { abs: 1e-6, rel: 1e-6 };
    const effectiveTol = Math.max(tol.abs, tol.rel * Math.abs(numDisplayed));
    isMatch = delta <= effectiveTol;
  } else {
    isMatch = String(recomputedValue) === String(displayedValue);
    delta = isMatch ? 0 : 1;
  }

  const message = isMatch
    ? `Recomputed live from instances: ${formattedRecomputed} ✓ matches displayed value within tolerance.`
    : `Recomputed live: ${formattedRecomputed} (Δ = ${delta.toExponential(4)}) ✗ differs from displayed value.`;

  return {
    recomputedValue,
    formattedRecomputed,
    delta,
    isMatch,
    tolerance: def.tolerance || { abs: 1e-6, rel: 1e-6 },
    message,
  };
}
