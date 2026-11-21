/**
 * Deep proof links serialization and parsing.
 * Supports sharing and restoring inspect drawer state, filters, and target scopes.
 *
 * Hash schema:
 * #/inspect?tab=...&def=...&metric=...&bucket=...&start=...&end=...&window=...&release_id=...&target=...
 */

export interface ProofLinkParams {
  tab?: string;
  domain?: string;
  defId?: string;
  metric?: string;
  bucket?: string;
  start?: number;
  end?: number;
  target?: string;
  window?: number;
  openTimeMs?: number;
  release_id?: string;
}

/**
 * Creates a proof link hash string from parameters.
 */
export function createProofLink(params: ProofLinkParams): string {
  const sp = new URLSearchParams();
  if (params.tab) sp.set('tab', params.tab);
  if (params.domain) sp.set('domain', params.domain);
  if (params.defId) sp.set('def', params.defId);
  if (params.metric) sp.set('metric', params.metric);
  if (params.bucket) sp.set('bucket', params.bucket);
  if (params.target) sp.set('target', params.target);
  if (params.start !== undefined && !isNaN(params.start)) sp.set('start', String(params.start));
  if (params.end !== undefined && !isNaN(params.end)) sp.set('end', String(params.end));
  if (params.window !== undefined && !isNaN(params.window)) sp.set('window', String(params.window));
  if (params.openTimeMs !== undefined && !isNaN(params.openTimeMs)) sp.set('open_time_ms', String(params.openTimeMs));
  if (params.release_id) sp.set('release_id', params.release_id);

  const qs = sp.toString();
  return qs ? `#/inspect?${qs}` : '#/inspect';
}

/**
 * Parses a window location hash string into proof link parameters.
 * Returns null if the hash is not a valid proof link.
 */
export function parseProofLink(hash: string): ProofLinkParams | null {
  if (!hash || !hash.startsWith('#/inspect')) return null;

  const qIdx = hash.indexOf('?');
  if (qIdx === -1) {
    return {};
  }

  const queryStr = hash.substring(qIdx + 1);
  const sp = new URLSearchParams(queryStr);
  const res: ProofLinkParams = {};

  if (sp.has('tab')) res.tab = sp.get('tab')!;
  if (sp.has('domain')) res.domain = sp.get('domain')!;
  if (sp.has('def')) res.defId = sp.get('def')!;
  if (sp.has('metric')) res.metric = sp.get('metric')!;
  if (sp.has('bucket')) res.bucket = sp.get('bucket')!;
  if (sp.has('target')) res.target = sp.get('target')!;
  if (sp.has('release_id')) res.release_id = sp.get('release_id')!;

  if (sp.has('open_time_ms')) {
    const t = Number(sp.get('open_time_ms'));
    if (!isNaN(t)) res.openTimeMs = t;
  }

  if (sp.has('start')) {
    const s = Number(sp.get('start'));
    if (!isNaN(s)) res.start = s;
  }
  if (sp.has('end')) {
    const e = Number(sp.get('end'));
    if (!isNaN(e)) res.end = e;
  }
  if (sp.has('window')) {
    const w = Number(sp.get('window'));
    if (!isNaN(w)) res.window = w;
  }

  return res;
}
