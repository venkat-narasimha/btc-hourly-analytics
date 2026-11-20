/**
 * Vitest tests for the Contextual Info Tooltip component.
 */

import { describe, it, expect } from 'vitest';
import { renderInfoTooltip, renderInspectTrigger } from './tooltip';

describe('renderInfoTooltip', () => {
  it('renders basic tooltip markup with accessible attributes', () => {
    const html = renderInfoTooltip({
      title: 'Test Metric',
      description: 'A test description of the metric.',
    });

    expect(html).toContain('class="info-tip pos-top"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Information: Test Metric"');
    expect(html).toContain('Test Metric');
    expect(html).toContain('A test description of the metric.');
    expect(html).not.toContain('info-formula-block');
    expect(html).not.toContain('info-caveat-block');
  });

  it('renders mathematical formula when provided', () => {
    const html = renderInfoTooltip({
      title: 'Formula Metric',
      description: 'Calculates return.',
      formula: 'r_t = ln(c_t / c_{t-1})',
      position: 'bottom',
    });

    expect(html).toContain('pos-bottom');
    expect(html).toContain('info-formula-block');
    expect(html).toContain('r_t = ln(c_t / c_{t-1})');
    expect(html).toContain('FORMULA');
  });

  it('renders statistical caveat when provided', () => {
    const html = renderInfoTooltip({
      title: 'Caveat Metric',
      description: 'Statistical significance warning.',
      caveat: 'Sample size underpowered (n < 30).',
    });

    expect(html).toContain('info-caveat-block');
    expect(html).toContain('CAVEAT');
    expect(html).toContain('Sample size underpowered');
  });

  it('escapes dangerous HTML characters in title and description', () => {
    const html = renderInfoTooltip({
      title: '<script>alert("xss")</script>',
      description: 'Image <img src="x" onerror="evil()" />',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src="x"');
  });

  it('renders formula from registry and inspect button when defId is provided', () => {
    const html = renderInfoTooltip({
      title: 'Total Observations',
      description: 'Dataset rows',
      defId: 'kpi.total_bars',
    });

    expect(html).toContain('N = Total Hourly Observations');
    expect(html).toContain('inspect-verify-btn');
    expect(html).toContain('data-inspect-def="kpi.total_bars"');
    expect(html).toContain('Inspect &amp; Verify');
  });

  it('renders inspect trigger button correctly', () => {
    const html = renderInspectTrigger('kpi.max_drawdown', { title: 'Inspect MDD' });
    expect(html).toContain('inspect-trigger-btn');
    expect(html).toContain('data-inspect-def="kpi.max_drawdown"');
    expect(html).toContain('title="Inspect MDD"');
  });
});
