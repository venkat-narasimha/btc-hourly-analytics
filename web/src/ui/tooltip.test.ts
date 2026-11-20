/**
 * Vitest tests for the Contextual Info Tooltip component.
 */

import { describe, it, expect } from 'vitest';
import { renderInfoTooltip } from './tooltip';

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

  it('renders caveat block when provided', () => {
    const html = renderInfoTooltip({
      title: 'Caveat Metric',
      description: 'Descriptive indicator.',
      caveat: 'Low explanatory power across single sessions.',
      position: 'left',
    });

    expect(html).toContain('pos-left');
    expect(html).toContain('info-caveat-block');
    expect(html).toContain('Low explanatory power across single sessions.');
    expect(html).toContain('CAVEAT');
  });

  it('escapes HTML to prevent injection vulnerabilities', () => {
    const html = renderInfoTooltip({
      title: '<script>alert(1)</script>',
      description: 'Value is > 10 & < 20',
      formula: 'x < y && y > z',
      caveat: 'Caution: <b>risk</b>',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&gt; 10 &amp; &lt; 20');
    expect(html).toContain('x &lt; y &amp;&amp; y &gt; z');
    expect(html).toContain('Caution: &lt;b&gt;risk&lt;/b&gt;');
  });
});
