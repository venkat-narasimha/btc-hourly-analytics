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
  return 'dark'; // Default theme is dark
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
      textSecondary: '#475569',
      gridLineColor: 'rgba(0,0,0,0.04)',
      borderColor: 'rgba(0,0,0,0.07)',
      tooltipBg: 'rgba(255,255,255,0.97)',
      tooltipBorder: 'rgba(0,0,0,0.12)',
      tooltipText: '#0f172a',
      candleUp: '#059669',
      candleDown: '#dc2626',
      volumeBar: '#4f46e5',
    };
  }

  return {
    background: '#0f1623',
    panelBackground: '#0f1623',
    textColor: '#f1f5f9',
    textSecondary: '#94a3b8',
    gridLineColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.06)',
    tooltipBg: 'rgba(13,17,23,0.96)',
    tooltipBorder: 'rgba(255,255,255,0.12)',
    tooltipText: '#f1f5f9',
    candleUp: '#10b981',
    candleDown: '#ef4444',
    volumeBar: '#6366f1',
  };
}
