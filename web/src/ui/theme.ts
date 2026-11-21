/**
 * Theme management and color tokens for Light and Dark modes.
 */

import type { Theme } from '../types';

const THEME_STORAGE_KEY = 'btc_analytics_theme';
const LEGACY_THEME_STORAGE_KEY = 'btc_theme';

export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore
  }
  return 'light'; // Default theme is light
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, theme);
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
      background: '#FFFFFF',
      panelBackground: '#FFFFFF',
      textColor: '#211A10',
      textSecondary: '#8B8069',
      gridLineColor: '#E6DCC6',
      borderColor: '#D8CCAE',
      tooltipBg: '#FFFFFF',
      tooltipBorder: '#D8CCAE',
      tooltipText: '#211A10',
      candleUp: '#0E9F6E',
      candleDown: '#E02424',
      volumeBar: '#F7931A',
    };
  }

  return {
    background: '#181410',
    panelBackground: '#181410',
    textColor: '#F5EEDF',
    textSecondary: '#9A8F79',
    gridLineColor: '#2B2418',
    borderColor: '#3A3120',
    tooltipBg: '#181410',
    tooltipBorder: '#3A3120',
    tooltipText: '#F5EEDF',
    candleUp: '#34D399',
    candleDown: '#F87171',
    volumeBar: '#F7931A',
  };
}
