/**
 * Global controls bar component.
 * Manages:
 * - Tab switching
 * - Date range filter (1M / 3M / 1Y / All + Custom)
 * - UTC ↔ IST display toggle (price chart only)
 * - Light ↔ Dark theme toggle (default light)
 */

import type { TabId, Theme } from '../types';

export interface ControlsState {
  activeTab: TabId;
  preset: '1M' | '3M' | '1Y' | 'All' | 'Custom';
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isIst: boolean;
  theme: Theme;
}

export interface ControlsCallbacks {
  onTabChange(tab: TabId): void;
  onRangeChange(startMs: number, endMs: number): void;
  onTimezoneChange(isIst: boolean): void;
  onThemeChange(theme: Theme): void;
}

export function createControls(
  container: HTMLElement,
  minMs: number,
  maxMs: number,
  initialTheme: Theme,
  callbacks: ControlsCallbacks
): {
  getState(): ControlsState;
  setTab(tab: TabId): void;
  setTheme(theme: Theme): void;
} {
  const minDateStr = new Date(minMs).toISOString().substring(0, 10);
  const maxDateStr = new Date(maxMs).toISOString().substring(0, 10);

  const state: ControlsState = {
    activeTab: 'price',
    preset: 'All',
    startDate: minDateStr,
    endDate: maxDateStr,
    isIst: false,
    theme: initialTheme,
  };

  container.innerHTML = `
    <header class="app-header" style="padding: 10px 20px; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 28px; height: 28px; background: #f59e0b; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; color: #000;">₿</div>
          <div>
            <div style="font-weight: 700; font-size: 15px; color: var(--text-primary); letter-spacing: -0.2px;">BTCUSDT 1h Analytics</div>
            <div style="font-size: 10px; color: var(--text-muted);">Binance USDⓈ-M Futures · 2020 → Present</div>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <nav class="nav-tabs" style="display: flex; gap: 4px; padding: 3px; border-radius: 6px; margin-left: 12px;">
          <button class="nav-tab active" data-tab="price">Price</button>
          <button class="nav-tab" data-tab="seasonality">Seasonality</button>
          <button class="nav-tab" data-tab="quality">Data Quality</button>
          <button class="nav-tab" data-tab="heatmap">7×24 Heatmap</button>
          <button class="nav-tab" data-tab="volatility">Volatility</button>
          <button class="nav-tab" data-tab="flow">Order Flow</button>
          <button class="nav-tab" data-tab="calendar">Calendar & Risk</button>
        </nav>
      </div>

      <!-- Global Filter Controls & Theme -->
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 14px;">
        <!-- Date Presets -->
        <div class="preset-buttons" style="display: flex; gap: 2px; padding: 2px; border-radius: 5px;">
          <button class="preset-btn" data-preset="1M">1M</button>
          <button class="preset-btn" data-preset="3M">3M</button>
          <button class="preset-btn" data-preset="1Y">1Y</button>
          <button class="preset-btn active" data-preset="All">All</button>
        </div>

        <!-- Custom Date Range -->
        <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary);">
          <input type="date" id="start-date-input" value="${minDateStr}" min="${minDateStr}" max="${maxDateStr}" />
          <span>→</span>
          <input type="date" id="end-date-input" value="${maxDateStr}" min="${minDateStr}" max="${maxDateStr}" />
        </div>

        <!-- Timezone Toggle (UTC / IST) -->
        <div style="display: flex; align-items: center; gap: 6px; border-left: 1px solid var(--border-color); padding-left: 12px;">
          <span style="font-size: 12px; color: var(--text-secondary);">Axis:</span>
          <div class="tz-buttons" style="display: flex; border-radius: 4px; padding: 2px;">
            <button class="tz-btn active" data-tz="utc">UTC</button>
            <button class="tz-btn" data-tz="ist">IST</button>
          </div>
        </div>

        <!-- Theme Toggle (Light / Dark) -->
        <div style="display: flex; align-items: center; gap: 6px; border-left: 1px solid var(--border-color); padding-left: 12px;">
          <div class="theme-buttons" style="display: flex; border-radius: 4px; padding: 2px;">
            <button class="theme-btn ${initialTheme === 'light' ? 'active' : ''}" data-theme-val="light" title="Light Theme">☀️ Light</button>
            <button class="theme-btn ${initialTheme === 'dark' ? 'active' : ''}" data-theme-val="dark" title="Dark Theme">🌙 Dark</button>
          </div>
        </div>
      </div>
    </header>
  `;

  // DOM Elements
  const tabButtons = container.querySelectorAll<HTMLButtonElement>('.nav-tab');
  const presetButtons = container.querySelectorAll<HTMLButtonElement>('.preset-btn');
  const tzButtons = container.querySelectorAll<HTMLButtonElement>('.tz-btn');
  const themeButtons = container.querySelectorAll<HTMLButtonElement>('.theme-btn');
  const startDateInput = container.querySelector<HTMLInputElement>('#start-date-input')!;
  const endDateInput = container.querySelector<HTMLInputElement>('#end-date-input')!;

  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as TabId;
      if (tab === state.activeTab) return;
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTab = tab;
      callbacks.onTabChange(tab);
    });
  });

  // Calculate range from preset
  function applyPreset(preset: '1M' | '3M' | '1Y' | 'All') {
    state.preset = preset;
    presetButtons.forEach(b => b.classList.toggle('active', b.dataset.preset === preset));

    let startMs = minMs;
    const endMs = maxMs;

    if (preset === '1M') {
      startMs = maxMs - 30 * 24 * 3600 * 1000;
    } else if (preset === '3M') {
      startMs = maxMs - 90 * 24 * 3600 * 1000;
    } else if (preset === '1Y') {
      startMs = maxMs - 365 * 24 * 3600 * 1000;
    } else if (preset === 'All') {
      startMs = minMs;
    }

    startMs = Math.max(startMs, minMs);

    state.startDate = new Date(startMs).toISOString().substring(0, 10);
    state.endDate = new Date(endMs).toISOString().substring(0, 10);
    startDateInput.value = state.startDate;
    endDateInput.value = state.endDate;

    callbacks.onRangeChange(startMs, endMs);
  }

  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset as '1M' | '3M' | '1Y' | 'All';
      applyPreset(p);
    });
  });

  function applyCustomDates() {
    state.preset = 'Custom';
    presetButtons.forEach(b => b.classList.remove('active'));

    const s = new Date(startDateInput.value + 'T00:00:00Z').getTime();
    const e = new Date(endDateInput.value + 'T23:59:59Z').getTime();

    if (!isNaN(s) && !isNaN(e) && s <= e) {
      callbacks.onRangeChange(s, e);
    }
  }

  startDateInput.addEventListener('change', applyCustomDates);
  endDateInput.addEventListener('change', applyCustomDates);

  // Timezone toggle
  tzButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const isIst = btn.dataset.tz === 'ist';
      state.isIst = isIst;
      tzButtons.forEach(b => b.classList.toggle('active', (b.dataset.tz === 'ist') === isIst));
      callbacks.onTimezoneChange(isIst);
    });
  });

  // Theme toggle
  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const th = btn.dataset.themeVal as Theme;
      if (state.theme === th) return;
      state.theme = th;
      themeButtons.forEach(b => b.classList.toggle('active', b.dataset.themeVal === th));
      callbacks.onThemeChange(th);
    });
  });

  return {
    getState: () => state,
    setTab(tab: TabId) {
      state.activeTab = tab;
      tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      callbacks.onTabChange(tab);
    },
    setTheme(theme: Theme) {
      state.theme = theme;
      themeButtons.forEach(b => b.classList.toggle('active', b.dataset.themeVal === theme));
      callbacks.onThemeChange(theme);
    },
  };
}
