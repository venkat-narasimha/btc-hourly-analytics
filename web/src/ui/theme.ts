/**
 * Theme management and color tokens for Light and Dark modes.
 */

import type { Theme } from '../types';

const THEME_STORAGE_KEY = 'btc_analytics_theme';

export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore
  }
  return 'light'; // Default theme is light
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  document.documentElement.setAttribute('data-theme', theme);
}

export interface ChartThemeColors {
  background: string;
  panelBackground: string;
  textColor: string;
  textSecondary: string;
  gridLineColor: string;
  borderColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  candleUp: string;
  candleDown: string;
  volumeBar: string;
}

export function getChartTheme(theme: Theme): ChartThemeColors {
  if (theme === 'light') {
    return {
      background: '#ffffff',
      panelBackground: '#ffffff',
      textColor: '#0f172a',
      textSecondary: '#64748b',
      gridLineColor: '#f1f5f9',
      borderColor: '#e2e8f0',
      tooltipBg: 'rgba(255, 255, 255, 0.95)',
      tooltipBorder: '#cbd5e1',
      tooltipText: '#0f172a',
      candleUp: '#10b981',
      candleDown: '#ef4444',
      volumeBar: '#3b82f6',
    };
  }

  return {
    background: '#090d16',
    panelBackground: '#0f172a',
    textColor: '#f8fafc',
    textSecondary: '#94a3b8',
    gridLineColor: '#1e293b',
    borderColor: '#334155',
    tooltipBg: 'rgba(15, 23, 42, 0.92)',
    tooltipBorder: '#334155',
    tooltipText: '#f8fafc',
    candleUp: '#10b981',
    candleDown: '#ef4444',
    volumeBar: '#60a5fa',
  };
}
