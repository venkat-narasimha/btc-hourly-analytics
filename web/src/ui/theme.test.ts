import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getInitialTheme, saveTheme } from './theme';
import * as fs from 'fs';
import * as path from 'path';

describe('Theme Management (UI Polish)', () => {
  let mockStorage: Record<string, string> = {};
  let mockAttributes: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    mockAttributes = {};

    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
      clear: () => { mockStorage = {}; },
      removeItem: (key: string) => { delete mockStorage[key]; },
    };

    (globalThis as any).document = {
      documentElement: {
        setAttribute: (attr: string, val: string) => { mockAttributes[attr] = String(val); },
        getAttribute: (attr: string) => mockAttributes[attr] ?? null,
        removeAttribute: (attr: string) => { delete mockAttributes[attr]; },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
    delete (globalThis as any).document;
  });

  it('defaults to light theme when no storage preference exists', () => {
    expect(getInitialTheme()).toBe('light');
  });

  it('respects explicitly stored dark theme', () => {
    localStorage.setItem('btc_analytics_theme', 'dark');
    expect(getInitialTheme()).toBe('dark');
  });

  it('respects explicitly stored light theme', () => {
    localStorage.setItem('btc_analytics_theme', 'light');
    expect(getInitialTheme()).toBe('light');
  });

  it('saves theme to localStorage and sets data-theme attribute on documentElement', () => {
    saveTheme('dark');
    expect(localStorage.getItem('btc_analytics_theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    saveTheme('light');
    expect(localStorage.getItem('btc_analytics_theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('asserts index.html has data-theme="light" as default attribute', () => {
    const indexPath = path.resolve(__dirname, '../../index.html');
    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toContain('data-theme="light"');
  });

  it('asserts validation table action buttons are unified to "Verify →"', () => {
    const valPath = path.resolve(__dirname, 'validation.ts');
    const content = fs.readFileSync(valPath, 'utf-8');
    expect(content).not.toContain('Drill Down &rarr;');
    expect(content).not.toContain('Inspect Bounding &rarr;');
    expect(content).not.toContain('View Math &rarr;');
    expect(content).not.toContain('View Bars &rarr;');
  });
});
