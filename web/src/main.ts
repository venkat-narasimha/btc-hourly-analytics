/**
 * Main application entry point.
 * Orchestrates:
 * - Data fetching (meta.json -> quality_report.json -> btcusdt_1h.parquet)
 * - Auto-retry if artifacts are not yet ready (initial ETL in progress)
 * - Global date filter & timezone state
 * - Light / Dark theme management (default light)
 * - Tab mounting / unmounting
 */

import './style.css';
import type { KlineRow, Meta, QualityReport, TabId, Theme } from './types';
import { fetchKlines, fetchMeta, fetchQualityReport, filterByRange } from './data/loader';
import { getInitialTheme, saveTheme } from './ui/theme';
import { createControls } from './ui/controls';
import { createPriceChart, type PriceChartInstance } from './charts/price';
import { createSeasonalityView, type SeasonalityChartInstance } from './charts/seasonality';
import { renderQualityReport } from './ui/quality';
import { createHeatmapView, type HeatmapChartInstance } from './charts/heatmap';
import { createVolatilityView, type VolatilityViewInstance } from './charts/volatility';
import { createFlowView, type FlowViewInstance } from './charts/flow';
import { createCalendarView, type CalendarViewInstance } from './charts/calendar';

const app = document.querySelector<HTMLDivElement>('#app')!;

// App layout
app.innerHTML = `
  <div id="controls-container"></div>
  <main id="main-content">
    <div id="status-container" class="status-overlay">
      <div class="spinner"></div>
      <div id="status-text" style="font-size: 14px; color: var(--text-secondary);">Connecting to analytics server...</div>
    </div>
    <div id="tab-content" style="width: 100%; height: 100%; display: none;"></div>
  </main>
`;

const controlsContainer = document.querySelector<HTMLDivElement>('#controls-container')!;
const statusContainer = document.querySelector<HTMLDivElement>('#status-container')!;
const statusText = document.querySelector<HTMLDivElement>('#status-text')!;
const tabContent = document.querySelector<HTMLDivElement>('#tab-content')!;

let allData: KlineRow[] = [];
let filteredData: KlineRow[] = [];
let metaData: Meta | null = null;
let qualityData: QualityReport | null = null;

let activeTab: TabId = 'price';
let isIst = false;
let currentStartMs = 0;
let currentEndMs = 0;
let currentTheme: Theme = getInitialTheme();

// Apply initial theme immediately to prevent flash of wrong theme
saveTheme(currentTheme);

// Current active view instance
let activeChartInstance: { destroy(): void } | null = null;

function setStatus(message: string, showSpinner = true) {
  statusContainer.style.display = 'flex';
  tabContent.style.display = 'none';
  statusText.textContent = message;
  const spinner = statusContainer.querySelector('.spinner') as HTMLElement;
  if (spinner) spinner.style.display = showSpinner ? 'block' : 'none';
}

function hideStatus() {
  statusContainer.style.display = 'none';
  tabContent.style.display = 'block';
}

// Fetch with retry if ETL is still running
async function loadArtifactsWithRetry(maxRetries = 30, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      setStatus(`Loading metadata (attempt ${attempt}/${maxRetries})...`);
      metaData = await fetchMeta();
      break;
    } catch {
      setStatus(`Artifacts not ready yet (ETL running). Retrying in 3s... (attempt ${attempt}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  if (!metaData) {
    throw new Error('Failed to load meta.json after multiple attempts.');
  }

  try {
    qualityData = await fetchQualityReport();
  } catch (err) {
    console.warn('Could not load quality_report.json:', err);
  }

  setStatus(`Loading ${metaData.rows.toLocaleString()} hourly bars from Parquet artifact...`);
  allData = await fetchKlines();

  if (allData.length === 0) {
    throw new Error('Parquet dataset is empty.');
  }

  // Sort chronologically just in case
  allData.sort((a, b) => Number(a.open_time_ms) - Number(b.open_time_ms));
  currentStartMs = allData[0].open_time_ms;
  currentEndMs = allData[allData.length - 1].open_time_ms;
  filteredData = allData;
}

function mountTab(tab: TabId) {
  if (activeChartInstance) {
    activeChartInstance.destroy();
    activeChartInstance = null;
  }

  tabContent.innerHTML = '';
  activeTab = tab;

  switch (tab) {
    case 'price': {
      activeChartInstance = createPriceChart(tabContent, filteredData, isIst, false, currentTheme);
      break;
    }
    case 'seasonality': {
      activeChartInstance = createSeasonalityView(tabContent, filteredData, 'mean_return', currentTheme);
      break;
    }
    case 'quality': {
      renderQualityReport(tabContent, metaData, qualityData);
      break;
    }
    case 'heatmap': {
      activeChartInstance = createHeatmapView(tabContent, filteredData, 'mean_return', currentTheme);
      break;
    }
    case 'volatility': {
      activeChartInstance = createVolatilityView(tabContent, filteredData, currentTheme);
      break;
    }
    case 'flow': {
      activeChartInstance = createFlowView(tabContent, filteredData, currentTheme);
      break;
    }
    case 'calendar': {
      activeChartInstance = createCalendarView(tabContent, filteredData, currentTheme);
      break;
    }
  }
}

function updateActiveTab() {
  if (!activeChartInstance) {
    mountTab(activeTab);
    return;
  }

  if (activeTab === 'price') {
    (activeChartInstance as PriceChartInstance).updateData(filteredData, isIst);
  } else if (activeTab === 'seasonality') {
    (activeChartInstance as SeasonalityChartInstance).updateData(filteredData);
  } else if (activeTab === 'quality') {
    renderQualityReport(tabContent, metaData, qualityData);
  } else if (activeTab === 'heatmap') {
    (activeChartInstance as HeatmapChartInstance).updateData(filteredData);
  } else if (activeTab === 'volatility') {
    (activeChartInstance as VolatilityViewInstance).updateData(filteredData);
  } else if (activeTab === 'flow') {
    (activeChartInstance as FlowViewInstance).updateData(filteredData);
  } else if (activeTab === 'calendar') {
    (activeChartInstance as CalendarViewInstance).updateData(filteredData);
  }
}

async function init() {
  try {
    await loadArtifactsWithRetry();
    hideStatus();

    // Initialize top controls bar
    createControls(controlsContainer, currentStartMs, currentEndMs, currentTheme, {
      onTabChange: (tab) => {
        mountTab(tab);
      },
      onRangeChange: (startMs, endMs) => {
        currentStartMs = startMs;
        currentEndMs = endMs;
        filteredData = filterByRange(allData, startMs, endMs);
        updateActiveTab();
      },
      onTimezoneChange: (ist) => {
        isIst = ist;
        if (activeTab === 'price' && activeChartInstance) {
          (activeChartInstance as PriceChartInstance).updateData(filteredData, isIst);
        }
      },
      onThemeChange: (theme) => {
        currentTheme = theme;
        saveTheme(theme);
        if (activeTab === 'quality') {
          renderQualityReport(tabContent, metaData, qualityData);
        } else if (activeChartInstance && 'setTheme' in activeChartInstance) {
          (activeChartInstance as any).setTheme(theme);
        }
      },
    });

    // Mount initial default tab
    mountTab('price');
  } catch (err: any) {
    setStatus(`Initialization Error: ${err?.message || err}`, false);
    console.error(err);
  }
}

init();
