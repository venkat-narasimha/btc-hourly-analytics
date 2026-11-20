/**
 * Verification Badges and Tab Runner for Verification Playground.
 *
 * Badges:
 * - unchecked (gray)
 * - match (green)
 * - mismatch (amber)
 * - error (red)
 *
 * Keyed by defId + normalized params in-memory.
 */

import type { KlineRow, Meta, QualityReport } from '../types';
import { runParityCheck, type ParityCheckResult, type ParityStatus } from './parity';
import { getMetricDef } from './registry';

const badgeResults = new Map<string, ParityCheckResult>();
const subscribers = new Set<() => void>();

export function getBadgeKey(defId: string, params?: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) return defId;
  const sorted = Object.keys(params)
    .sort()
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return sorted ? `${defId}?${sorted}` : defId;
}

export function subscribeBadges(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function notifySubscribers(): void {
  subscribers.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error('Badge subscriber error:', err);
    }
  });
}

export function getBadgeResult(defId: string, params?: Record<string, any>): ParityCheckResult | undefined {
  const key = getBadgeKey(defId, params);
  return badgeResults.get(key);
}

export function getBadgeStatus(defId: string, params?: Record<string, any>): ParityStatus {
  const def = getMetricDef(defId);
  if (!def || def.kind === 'provenance' || !def.sql) {
    return 'unchecked';
  }
  const res = getBadgeResult(defId, params);
  return res ? res.status : 'unchecked';
}

export function setBadgeResult(result: ParityCheckResult, params?: Record<string, any>): void {
  const key = getBadgeKey(result.defId, params);
  badgeResults.set(key, result);

  // Update existing DOM badge elements matching this defId if present in document
  if (typeof document !== 'undefined') {
    const badgeEls = document.querySelectorAll<HTMLElement>(`.parity-badge[data-def-id="${result.defId}"]`);
    badgeEls.forEach((el) => {
      const parent = el.parentElement;
      if (parent) {
        const temp = document.createElement('div');
        temp.innerHTML = renderParityBadge(result.defId, params);
        const newEl = temp.firstElementChild;
        if (newEl) {
          el.replaceWith(newEl);
        }
      }
    });
  }

  notifySubscribers();
}

export function clearBadges(): void {
  badgeResults.clear();
  notifySubscribers();
}

/**
 * Renders HTML for a verification status badge.
 */
export function renderParityBadge(
  defId: string,
  params?: Record<string, any>,
  options?: { size?: 'sm' | 'md'; showLabel?: boolean }
): string {
  const def = getMetricDef(defId);
  if (!def || def.kind === 'provenance' || !def.sql) {
    return '';
  }

  const status = getBadgeStatus(defId, params);
  const size = options?.size ?? 'sm';
  const showLabel = options?.showLabel ?? true;

  let bgClass = 'bg-[var(--surface-muted)] text-[var(--text-muted)] border-[var(--border-subtle)]';
  let icon = `
    <svg class="w-3 h-3 inline-block mr-1 opacity-70" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="8" r="4"/>
    </svg>
  `;
  let labelText = 'Unverified';

  if (status === 'match') {
    bgClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    icon = `
      <svg class="w-3 h-3 inline-block mr-1" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd"/>
      </svg>
    `;
    labelText = 'SQL Parity ✓';
  } else if (status === 'mismatch') {
    bgClass = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    icon = `
      <svg class="w-3 h-3 inline-block mr-1" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.798a1.5 1.5 0 0 1-1.299-2.25l5.2-9ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/>
      </svg>
    `;
    labelText = 'Mismatch Δ';
  } else if (status === 'error') {
    bgClass = 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    icon = `
      <svg class="w-3 h-3 inline-block mr-1" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/>
      </svg>
    `;
    labelText = 'SQL Error';
  }

  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  const key = getBadgeKey(defId, params);

  return `
    <span class="parity-badge inline-flex items-center font-mono font-medium rounded border ${bgClass} ${padding}"
          data-badge-key="${key}"
          data-def-id="${defId}"
          title="DuckDB-WASM cross-check status: ${labelText}">
      ${icon}${showLabel ? `<span>${labelText}</span>` : ''}
    </span>
  `;
}

/**
 * Runs parity checks for a batch of visible metric definitions with progress tracking.
 */
export async function verifyVisibleMetrics(
  defs: Array<{ defId: string; params?: Record<string, any> }>,
  rows: KlineRow[],
  context?: { meta?: Meta | null; qualityData?: QualityReport | null },
  onProgress?: (completed: number, total: number, currentDefId: string) => void
): Promise<ParityCheckResult[]> {
  const results: ParityCheckResult[] = [];
  const validDefs = defs.filter((d) => {
    const m = getMetricDef(d.defId);
    return m && m.kind !== 'provenance' && !!m.sql;
  });

  const total = validDefs.length;
  let completed = 0;

  for (const item of validDefs) {
    if (onProgress) {
      onProgress(completed, total, item.defId);
    }
    const res = await runParityCheck(item.defId, rows, item.params, context);
    setBadgeResult(res, item.params);
    results.push(res);
    completed++;
    if (onProgress) {
      onProgress(completed, total, item.defId);
    }
  }

  return results;
}
