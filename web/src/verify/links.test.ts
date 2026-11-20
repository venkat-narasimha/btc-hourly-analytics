import { describe, it, expect } from 'vitest';
import { createProofLink, parseProofLink, type ProofLinkParams } from './links';

describe('Proof Links (Phase A)', () => {
  it('serializes and parses full proof link parameters', () => {
    const params: ProofLinkParams = {
      tab: 'seasonality',
      defId: 'seasonality.mean_return',
      metric: 'mean_return',
      bucket: 'hour',
      start: 1600000000000,
      end: 1700000000000,
      window: 168,
      release_id: 'release-2026-v1',
      target: '14',
    };

    const link = createProofLink(params);
    expect(link).toContain('#/inspect?');
    expect(link).toContain('tab=seasonality');
    expect(link).toContain('def=seasonality.mean_return');
    expect(link).toContain('bucket=hour');
    expect(link).toContain('window=168');
    expect(link).toContain('release_id=release-2026-v1');
    expect(link).toContain('target=14');

    const parsed = parseProofLink(link);
    expect(parsed).toEqual(params);
  });

  it('handles partial parameters gracefully', () => {
    const params: ProofLinkParams = {
      tab: 'overview',
      defId: 'kpi.max_drawdown',
    };
    const link = createProofLink(params);
    const parsed = parseProofLink(link);
    expect(parsed?.tab).toBe('overview');
    expect(parsed?.defId).toBe('kpi.max_drawdown');
    expect(parsed?.start).toBeUndefined();
    expect(parsed?.window).toBeUndefined();
  });

  it('returns null for non-proof hashes or empty hash', () => {
    expect(parseProofLink('')).toBeNull();
    expect(parseProofLink('#/overview')).toBeNull();
    expect(parseProofLink('#random-hash')).toBeNull();
  });

  it('handles bare #/inspect without query params', () => {
    const parsed = parseProofLink('#/inspect');
    expect(parsed).toEqual({});
  });
});
