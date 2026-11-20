/**
 * Main application entry point.
 * Orchestrates:
 * - Responsive app shell (collapsible sidebar, telemetry topbar, dynamic content)
 * - Sequential data loading with branded progress indicator
 * - 8 Dedicated analytical tabs (Overview, Price, Seasonality, 7x24 Heatmap,
 *   Volatility, Order Flow, Calendar & Risk, Data Quality)
 * - Per-page date filtering and timezone translation
 * - Full Dark / Light theme synchronization
 */

import './style.css';
import type { KlineRow, Meta, QualityReport, TabId, Theme } from './types';
import { fetchKlines, fetchMeta, fetchQualityReport, filterByRange } from './data/loader';
import { getInitialTheme, saveTheme } from './ui/theme';
import { createSidebar } from './ui/sidebar';
import { createTopbar, type TopbarStats } from './ui/topbar';
import { createFilterbar } from './ui/filterbar';
import { createOverviewPage } from './ui/overview';
import { renderQualityReport } from './ui/quality';
import {
  renderOverviewSkeleton,
  renderChartPageSkeleton,
  renderQualitySkeleton,
} from './ui/skeleton';
import { createPriceChart, type PriceChartInstance } from './charts/price';
import { createSeasonalityView, type SeasonalityChartInstance } from './charts/seasonality';
import { createHeatmapView, type HeatmapChartInstance } from './charts/heatmap';
import { createVolatilityView, type VolatilityViewInstance } from './charts/volatility';
import { createFlowView, type FlowViewInstance } from './charts/flow';
import { createCalendarView, type CalendarViewInstance } from './charts/calendar';

const PAGE_INFO: Record<TabId, { title: string; subtitle: string; numCharts?: number }> = {
  overview: {
    title: 'Overview',
    subtitle: 'High-level macro health indicators, key metrics, and dataset synopsis',
  },
  price: {
    title: 'Price Action & Volume',
    subtitle: 'Institutional TradingView multi-pane candlestick chart with log scaling and volume profile',
    numCharts: 1,
  },
  seasonality: {
    title: 'Cyclical Seasonality',
    subtitle: 'Hour-of-day (0–23 UTC) and day-of-week return aggregations across market regimes',
    numCharts: 2,
  },
  heatmap: {
    title: '7×24 Hourly Matrix',
    subtitle: 'Comprehensive 168-cell day × hour heatmap visualizing recurring weekly liquidity and return cycles',
    numCharts: 1,
  },
  volatility: {
    title: 'Volatility & Distribution',
    subtitle: 'Rolling window volatility, 50-bin return histogram, skewness, kurtosis, and fat-tail quantiles',
    numCharts: 2,
  },
  flow: {
    title: 'Order Flow & Aggression',
    subtitle: 'Cumulative taker delta and hourly aggressive taker buy/sell imbalance dynamics',
    numCharts: 2,
  },
  calendar: {
    title: 'Calendar & Historical Risk',
    subtitle: 'Year × Month compounded return matrix and historical peak-to-trough underwater drawdown curve',
    numCharts: 2,
  },
  quality: {
    title: 'Data Quality & Provenance Audit',
    subtitle: 'Full integrity audit: SHA-256 checksums, exchange outage gaps, and raw ingestion normalizations',
  },
};

// Global application state
let allData: KlineRow[] = [];
let filteredData: KlineRow[] = [];
let metaData: Meta | null = null;
let qualityData: QualityReport | null = null;

let activeTab: TabId = 'overview';
let isIst = false;
let currentTheme: Theme = getInitialTheme();

// Apply initial theme immediately to prevent flashing
saveTheme(currentTheme);

let activeChartInstance: { destroy(): void } | null = null;
let sidebarInstance: ReturnType<typeof createSidebar> | null = null;
let topbarInstance: ReturnType<typeof createTopbar> | null = null;

function setStepDone(stepId: string) {
  const el = document.getElementById(stepId);
  if (el) {
    el.classList.remove('active');
    el.classList.add('done');
  }
}

function setStepActive(stepId: string) {
  const el = document.getElementById(stepId);
  if (el) {
    el.classList.add('active');
  }
}

function buildTopbarStats(): TopbarStats {
  const firstDate = new Date(allData[0].open_time_ms);
  const lastDate = new Date(allData[allData.length - 1].open_time_ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    totalBars: allData.length,
    coveragePct: qualityData?.coverage_pct ?? 100,
    dateRange: `${months[firstDate.getUTCMonth()]} ${firstDate.getUTCFullYear()} – ${months[lastDate.getUTCMonth()]} ${lastDate.getUTCFullYear()}`,
    latestPrice: allData[allData.length - 1]?.close ?? null,
    lastUpdated: metaData?.generated_at_utc ? metaData.generated_at_utc.substring(0, 10) : '',
  };
}

async function loadArtifactsWithRetry(maxRetries = 30, delayMs = 3000): Promise<void> {
  // Step 1: Metadata
  setStepActive('step-meta');
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      metaData = await fetchMeta();
      break;
    } catch {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  if (!metaData) {
    throw new Error('Failed to load meta.json after multiple attempts. ETL may still be initializing.');
  }
  setStepDone('step-meta');

  // Step 2: Quality report
  setStepActive('step-quality');
  try {
    qualityData = await fetchQualityReport();
  } catch (err) {
    console.warn('Could not load quality_report.json:', err);
  }
  setStepDone('step-quality');

  // Step 3: Parquet dataset
  setStepActive('step-parquet');
  allData = await fetchKlines();
  if (allData.length === 0) {
    throw new Error('Parquet dataset is empty.');
  }

  // Ensure strict chronological ordering
  allData.sort((a, b) => Number(a.open_time_ms) - Number(b.open_time_ms));
  filteredData = allData;
  setStepDone('step-parquet');

  // Step 4: Ready
  setStepActive('step-ready');
  await new Promise(r => setTimeout(r, 200));
  setStepDone('step-ready');
}

function renderPageHeader(title: string, subtitle: string): HTMLElement {
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div class="page-header-left">
      <h2 class="page-title">${title}</h2>
      <p class="page-subtitle">${subtitle}</p>
    </div>
  `;
  return header;
}

function mountTab(tab: TabId) {
  if (activeChartInstance) {
    activeChartInstance.destroy();
    activeChartInstance = null;
  }

  activeTab = tab;
  const content = document.getElementById('main-content')!;
  const pageMeta = PAGE_INFO[tab];

  if (topbarInstance) {
    topbarInstance.updatePageInfo(pageMeta.title, pageMeta.subtitle);
  }

  // Display instantaneous skeleton matching target page structure
  if (tab === 'overview') {
    renderOverviewSkeleton(content);
  } else if (tab === 'quality') {
    renderQualitySkeleton(content);
  } else {
    renderChartPageSkeleton(content, pageMeta.numCharts ?? 1);
  }

  // Render actual content in next frame to allow smooth transition
  requestAnimationFrame(() => {
    content.innerHTML = '';

    switch (tab) {
      case 'overview': {
        if (metaData) {
          createOverviewPage(content, filteredData, metaData, qualityData);
        }
        break;
      }

      case 'price': {
        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper tab-enter';
        content.appendChild(wrapper);

        wrapper.appendChild(renderPageHeader(pageMeta.title, pageMeta.subtitle));

        // Dedicated Filterbar with Timezone toggle
        const fbContainer = document.createElement('div');
        wrapper.appendChild(fbContainer);
        createFilterbar(
          fbContainer,
          {
            minMs: allData[0].open_time_ms,
            maxMs: allData[allData.length - 1].open_time_ms,
            initialIsIst: isIst,
            showTimezone: true,
          },
          {
            onRangeChange: (startMs, endMs) => {
              filteredData = filterByRange(allData, startMs, endMs);
              if (activeChartInstance && 'updateData' in activeChartInstance) {
                (activeChartInstance as PriceChartInstance).updateData(filteredData, isIst);
              }
            },
            onTimezoneChange: (ist) => {
              isIst = ist;
              if (activeChartInstance && 'updateData' in activeChartInstance) {
                (activeChartInstance as PriceChartInstance).updateData(filteredData, isIst);
              }
            },
          }
        );

        // Chart Card container
        const chartCard = document.createElement('div');
        chartCard.className = 'chart-card';
        chartCard.style.flex = '1';
        chartCard.style.display = 'flex';
        chartCard.style.flexDirection = 'column';
        chartCard.style.minHeight = '560px';
        chartCard.style.height = 'calc(100vh - 220px)';
        wrapper.appendChild(chartCard);

        activeChartInstance = createPriceChart(chartCard, filteredData, isIst, false, currentTheme);
        break;
      }

      case 'seasonality': {
        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper tab-enter';
        content.appendChild(wrapper);

        wrapper.appendChild(renderPageHeader(pageMeta.title, pageMeta.subtitle));

        const fbContainer = document.createElement('div');
        wrapper.appendChild(fbContainer);
        createFilterbar(
          fbContainer,
          {
            minMs: allData[0].open_time_ms,
            maxMs: allData[allData.length - 1].open_time_ms,
            showTimezone: false,
          },
          {
            onRangeChange: (startMs, endMs) => {
              filteredData = filterByRange(allData, startMs, endMs);
              if (activeChartInstance && 'updateData' in activeChartInstance) {
                (activeChartInstance as SeasonalityChartInstance).updateData(filteredData);
              }
            },
            onTimezoneChange: () => {},
          }
        );

        const chartContainer = document.createElement('div');
        chartContainer.style.flex = '1';
        chartContainer.style.minHeight = '0';
        wrapper.appendChild(chartContainer);

        activeChartInstance = createSeasonalityView(chartContainer, filteredData, 'mean_return', currentTheme);
        break;
      }

      case 'heatmap': {
        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper tab-enter';
        content.appendChild(wrapper);

        wrapper.appendChild(renderPageHeader(pageMeta.title, pageMeta.subtitle));

        const fbContainer = document.createElement('div');
        wrapper.appendChild(fbContainer);
        createFilterbar(
          fbContainer,
          {
            minMs: allData[0].open_time_ms,
            maxMs: allData[allData.length - 1].open_time_ms,
            showTimezone: false,
          },
          {
            onRangeChange: (startMs, endMs) => {
              filteredData = filterByRange(allData, startMs, endMs);
              if (activeChartInstance && 'updateData' in activeChartInstance) {
                (activeChartInstance as HeatmapChartInstance).updateData(filteredData);
              }
            },
            onTimezoneChange: () => {},
          }
        );

        const chartContainer = document.createElement('div');
        chartContainer.style.flex = '1';
        chartContainer.style.minHeight = '0';
        wrapper.appendChild(chartContainer);

        activeChartInstance = createHeatmapView(chartContainer, filteredData, 'mean_return', currentTheme);
        break;
      }

      case 'volatility': {
        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper tab-enter';
        content.appendChild(wrapper);

        wrapper.appendChild(renderPageHeader(pageMeta.title, pageMeta.subtitle));

        const fbContainer = document.createElement('div');
        wrapper.appendChild(fbContainer);
        createFilterbar(
          fbContainer,
          {
            minMs: allData[0].open_time_ms,
            maxMs: allData[allData.length - 1].open_time_ms,
            showTimezone: false,
          },
          {
            onRangeChange: (startMs, endMs) => {
              filteredData = filterByRange(allData, startMs, endMs);
              if (activeChartInstance && 'updateData' in activeChartInstance) {
                (activeChartInstance as VolatilityViewInstance).updateData(filteredData);
              }
            },
            onTimezoneChange: () => {},
          }
        );

        const chartContainer = document.createElement('div');
        chartContainer.style.flex = '1';
        chartContainer.style.minHeight = '0';
        wrapper.appendChild(chartContainer);

        activeChartInstance = createVolatilityView(chartContainer, filteredData, currentTheme);
        break;
      }

      case 'flow': {
        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper tab-enter';
        content.appendChild(wrapper);

        wrapper.appendChild(renderPageHeader(pageMeta.title, pageMeta.subtitle));

        const fbContainer = document.createElement('div');
        wrapper.appendChild(fbContainer);
        createFilterbar(
          fbContainer,
          {
            minMs: allData[0].open_time_ms,
            maxMs: allData[allData.length - 1].open_time_ms,
            showTimezone: false,
          },
          {
            onRangeChange: (startMs, endMs) => {
              filteredData = filterByRange(allData, startMs, endMs);
              if (activeChartInstance && 'updateData' in activeChartInstance) {
                (activeChartInstance as FlowViewInstance).updateData(filteredData);
              }
            },
            onTimezoneChange: () => {},
          }
        );

        const chartContainer = document.createElement('div');
        chartContainer.style.flex = '1';
        chartContainer.style.minHeight = '0';
        wrapper.appendChild(chartContainer);

        activeChartInstance = createFlowView(chartContainer, filteredData, currentTheme);
        break;
      }

      case 'calendar': {
        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper tab-enter';
        content.appendChild(wrapper);

        wrapper.appendChild(renderPageHeader(pageMeta.title, pageMeta.subtitle));

        const fbContainer = document.createElement('div');
        wrapper.appendChild(fbContainer);
        createFilterbar(
          fbContainer,
          {
            minMs: allData[0].open_time_ms,
            maxMs: allData[allData.length - 1].open_time_ms,
            showTimezone: false,
          },
          {
            onRangeChange: (startMs, endMs) => {
              filteredData = filterByRange(allData, startMs, endMs);
              if (activeChartInstance && 'updateData' in activeChartInstance) {
                (activeChartInstance as CalendarViewInstance).updateData(filteredData);
              }
            },
            onTimezoneChange: () => {},
          }
        );

        const chartContainer = document.createElement('div');
        chartContainer.style.flex = '1';
        chartContainer.style.minHeight = '0';
        wrapper.appendChild(chartContainer);

        activeChartInstance = createCalendarView(chartContainer, filteredData, currentTheme);
        break;
      }

      case 'quality': {
        renderQualityReport(content, metaData, qualityData);
        break;
      }
    }
  });
}

async function init() {
  // 1. Enforce initial theme
  saveTheme(currentTheme);

  // 2. Build application structural layout
  const appEl = document.querySelector<HTMLDivElement>('#app')!;
  appEl.innerHTML = `
    <aside id="app-sidebar" class="app-sidebar" data-collapsed="false"></aside>
    <div class="app-main">
      <header id="app-topbar" class="app-topbar"></header>
      <main id="main-content" class="app-content" style="position: relative;"></main>
    </div>
  `;

  // 3. Mount sidebar
  const sidebarEl = document.getElementById('app-sidebar')!;
  sidebarInstance = createSidebar(sidebarEl, 'overview', currentTheme, {
    onTabChange: (tab) => {
      mountTab(tab);
      sidebarInstance?.setActiveTab(tab);
    },
    onThemeChange: (theme) => {
      currentTheme = theme;
      saveTheme(theme);
      if (activeChartInstance && 'setTheme' in activeChartInstance) {
        (activeChartInstance as any).setTheme(theme);
      }
      if (activeTab === 'overview' && metaData) {
        createOverviewPage(document.getElementById('main-content')!, filteredData, metaData, qualityData);
      } else if (activeTab === 'quality') {
        renderQualityReport(document.getElementById('main-content')!, metaData, qualityData);
      }
    },
  });

  // 4. Mount topbar
  const topbarEl = document.getElementById('app-topbar')!;
  topbarInstance = createTopbar(topbarEl, PAGE_INFO['overview']);

  // 5. Display branded loading state
  const mainContent = document.getElementById('main-content')!;
  mainContent.innerHTML = `
    <div class="loading-screen" id="loading-screen">
      <div class="loading-logo">₿</div>
      <div class="loading-steps">
        <div class="loading-step" id="step-meta">
          <span class="step-dot"></span>
          <span>Loading dataset metadata...</span>
        </div>
        <div class="loading-step" id="step-quality">
          <span class="step-dot"></span>
          <span>Fetching quality report...</span>
        </div>
        <div class="loading-step" id="step-parquet">
          <span class="step-dot"></span>
          <span>Reading Parquet dataset (~60k bars)...</span>
        </div>
        <div class="loading-step" id="step-ready">
          <span class="step-dot"></span>
          <span>Preparing analytics engine...</span>
        </div>
      </div>
    </div>
  `;

  try {
    // 6. Ingest data
    await loadArtifactsWithRetry();

    // 7. Update telemetry header
    topbarInstance.updateStats(buildTopbarStats());

    // 8. Mount default Overview page
    mountTab('overview');
  } catch (err: any) {
    mainContent.innerHTML = `
      <div class="loading-screen">
        <div class="loading-logo" style="background: var(--color-negative); color: #fff;">!</div>
        <div style="color: var(--text-secondary); font-size: var(--text-sm); text-align: center; max-width: 440px; line-height: 1.6;">
          <strong style="color: var(--color-negative); font-size: var(--text-md); display: block; margin-bottom: 6px;">Initialization Error</strong>
          ${err?.message ?? err}
        </div>
      </div>
    `;
    console.error('Fatal initialization error:', err);
  }
}

init();
