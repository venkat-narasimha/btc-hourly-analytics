/**
 * Verification Manifest Exporter.
 * Generates client-side verification_manifest.json per PLAN-verify.md §6.
 *
 * Rules:
 * - Emitted directly from browser definition registry.
 * - Computes SHA-256 of the parquet release artifact via in-browser crypto.subtle.
 * - Captures expected values across all 40 definitions (scalars, grouped/matrix, series summary, provenance).
 * - Downloadable from Data Quality tab.
 */

import type { KlineRow, Meta, QualityReport, SourceFile } from '../types';
import { getAllMetricDefs, type Result } from './registry';

export interface ManifestDefinition {
  id: string;
  kind: string;
  params: Record<string, any>;
  formula: string;
  conventions: string[];
  tolerance: { rel: number; abs: number };
  expected: any;
}

export interface VerificationManifest {
  schema_version: string;
  release_id: string;
  artifact_sha256: string;
  generated_at: string;
  pipeline_git_sha: string;
  scope: {
    start_ms: number;
    end_ms: number;
    start_iso: string;
    end_iso: string;
    total_bars: number;
  };
  source_files: SourceFile[];
  definitions: ManifestDefinition[];
}

/**
 * Computes SHA-256 hex string over ArrayBuffer or Uint8Array using crypto.subtle.
 */
export async function computeBufferSha256(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuf = await crypto.subtle.digest('SHA-256', buffer as BufferSource);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
}

/**
 * Fetches the raw parquet bytes for client-side SHA-256 hashing.
 */
export async function fetchParquetBuffer(): Promise<ArrayBuffer | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const res = await fetch('/data/current/btcusdt_1h.parquet', { cache: 'no-cache' });
    if (res.ok) {
      return await res.arrayBuffer();
    }
  } catch {
    // Network or server fetch error
  }
  return null;
}

/**
 * Formats a Result into the standard expected structure for manifest serialization.
 */
export function formatExpectedResult(res: Result): any {
  switch (res.kind) {
    case 'scalar':
      return {
        value: res.value,
        n: res.n,
      };
    case 'grouped':
    case 'matrix':
      return {
        keys: res.keys.map((k) => ({
          key: k.key,
          value: k.value,
          n: k.n,
        })),
        n: res.keys.reduce((sum, k) => sum + (k.n || 0), 0),
      };
    case 'series':
      return {
        n: res.summary.n,
        min: res.summary.min,
        max: res.summary.max,
        mean: res.summary.mean,
      };
    case 'provenance':
      return {
        report: res.report,
      };
  }
}

/**
 * Generates the complete verification manifest object from current app state.
 */
export async function generateManifest(
  rows: KlineRow[],
  meta: Meta | null,
  qualityData?: QualityReport | null,
  parquetBuffer?: ArrayBuffer | Uint8Array | null
): Promise<VerificationManifest> {
  let artifactSha = '';

  if (parquetBuffer) {
    artifactSha = await computeBufferSha256(parquetBuffer);
  } else {
    const fetched = await fetchParquetBuffer();
    if (fetched) {
      artifactSha = await computeBufferSha256(fetched);
    } else if (meta?.artifact_sha256) {
      artifactSha = meta.artifact_sha256;
    }
  }

  const startMs = rows.length > 0 ? rows[0].open_time_ms : meta?.first_open_ms ?? 0;
  const endMs = rows.length > 0 ? rows[rows.length - 1].open_time_ms : meta?.last_open_ms ?? 0;

  const allDefs = getAllMetricDefs();
  const manifestDefs: ManifestDefinition[] = [];

  for (const def of allDefs) {
    // Base parameter case
    const baseParams: Record<string, any> = {};
    const baseRes = def.compute(rows, baseParams, { meta, qualityData });
    manifestDefs.push({
      id: def.id,
      kind: def.kind,
      params: baseParams,
      formula: def.formula,
      conventions: def.conventions,
      tolerance: def.tolerance,
      expected: formatExpectedResult(baseRes),
    });

    // For seasonality definitions, also register dow bucket evaluation
    if (def.id.startsWith('seasonality.')) {
      const dowParams = { bucket: 'dow' };
      const dowRes = def.compute(rows, dowParams, { meta, qualityData });
      manifestDefs.push({
        id: def.id,
        kind: def.kind,
        params: dowParams,
        formula: def.formula,
        conventions: def.conventions,
        tolerance: def.tolerance,
        expected: formatExpectedResult(dowRes),
      });
    }
  }

  return {
    schema_version: '1.0',
    release_id: meta?.release_id ?? 'unknown',
    artifact_sha256: artifactSha,
    generated_at: new Date().toISOString(),
    pipeline_git_sha: meta?.pipeline_git_sha ?? 'unknown',
    scope: {
      start_ms: startMs,
      end_ms: endMs,
      start_iso: new Date(startMs).toISOString(),
      end_iso: new Date(endMs).toISOString(),
      total_bars: rows.length,
    },
    source_files: meta?.source_files ?? [],
    definitions: manifestDefs,
  };
}

/**
 * Triggers a browser file download for the manifest.
 */
export function downloadManifest(manifest: VerificationManifest, filename = 'verification_manifest.json'): void {
  if (typeof document === 'undefined') return;

  const jsonStr = JSON.stringify(manifest, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
