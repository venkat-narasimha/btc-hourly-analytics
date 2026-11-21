/**
 * In-App Guided Walkthrough Tour Module.
 * "Explore Every Microstructure Perspective & Transparent Proof"
 *
 * Provides:
 * 1. Global 11-step end-to-end tour across all 9 tabs.
 * 2. Contextual per-page walkthroughs triggered via topbar "✦ Page Guide".
 * 3. Zero external dependencies, pure TypeScript with SVG cut-out spotlight.
 */

import type { TabId } from '../types';

export interface TourStep {
  id: string;
  title: string;
  content: string;
  targetSelector: string;
  tab?: TabId;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  beforeMount?: () => void | Promise<void>;
}

export interface TourCallbacks {
  onTabChange(tab: TabId): void;
  onOpenVerifyDrawer?(defId: string): void;
}

const STORAGE_KEY_GLOBAL_TOUR = 'btc_tour_global_completed';

export const GLOBAL_TOUR_STEPS: TourStep[] = [
  {
    id: 'step-topbar',
    title: 'Institutional Integrity & Freshness',
    content: 'Real-time audit stats: 60k+ verified 1h bars, 100% calendar completeness, data through UTC, and automated daily pipeline freshness from Binance Vision.',
    targetSelector: '#topbar-stats',
    tab: 'overview',
    placement: 'bottom',
  },
  {
    id: 'step-kpis',
    title: 'Macro Indicator Cards & Sparkline',
    content: 'High-level market statistics: Period Return, Maximum Drawdown, Win Rate, and best/worst cyclical intervals with a 7-year sampled price sparkline.',
    targetSelector: '.kpis',
    tab: 'overview',
    placement: 'bottom',
  },
  {
    id: 'step-sidebar',
    title: '9 Analytical Microstructure Domains',
    content: 'Navigate across 9 distinct quantitative perspectives: Candlesticks, Seasonality tendencies, 7×24 Heatmap, Volatility moments, Order Flow (CVD), Calendar & Risk, Quality audit, and Enumerable Validation.',
    targetSelector: '#sidebar-nav',
    tab: 'overview',
    placement: 'right',
  },
  {
    id: 'step-price',
    title: 'Candlestick Action & Volume',
    content: 'High-performance TradingView Lightweight Charts rendering the full 60,000+ bar dataset with pan, zoom, hover crosshairs, and Linear vs Logarithmic scaling.',
    targetSelector: '#price-chart',
    tab: 'price',
    placement: 'top',
  },
  {
    id: 'step-seasonality',
    title: 'Cyclical Seasonality Tendencies',
    content: 'Uncover persistent tendencies across hours of the day and days of the week for Returns, Volatility, Taker Ratio, and Volume with session overlays.',
    targetSelector: '#seasonality-chart',
    tab: 'seasonality',
    placement: 'top',
  },
  {
    id: 'step-heatmap',
    title: '7×24 Day-Hour Matrix',
    content: 'Full 168-cell bivariate cross-tabulation with crisp 1.5px individual cell borders. Click any cell to inspect its underlying sample size and exact historical bars.',
    targetSelector: '#heatmap-chart',
    tab: 'heatmap',
    placement: 'top',
  },
  {
    id: 'step-volatility',
    title: 'Distribution Moments & Rolling Vol',
    content: '50-bin return distribution histogram, skewness, excess kurtosis fat-tail quantification, and an interactive 7d–90d rolling volatility window slider.',
    targetSelector: '#vol-chart',
    tab: 'volatility',
    placement: 'top',
  },
  {
    id: 'step-flow',
    title: 'Order Flow & Cumulative Taker Delta',
    content: 'Cumulative Volume Delta (CVD) tracking net aggressive taker buying vs selling, identifying liquidity flow around perpetual funding rate settlement boundaries.',
    targetSelector: '#cum-delta-chart',
    tab: 'flow',
    placement: 'bottom',
  },
  {
    id: 'step-calendar',
    title: 'Monthly Return Matrix & Risk',
    content: 'Comprehensive year-over-month performance matrix with color-coded returns, accompanied by historical high-water mark drawdown curves.',
    targetSelector: '.cal.data-table',
    tab: 'calendar',
    placement: 'top',
  },
  {
    id: 'step-quality',
    title: 'ETL Pipeline & Outage Disclosures',
    content: 'Cryptographic SHA-256 archive checksums, atomic release lineage, and documented Binance exchange outage gaps (strictly preserved as nulls, never fabricated).',
    targetSelector: '.bento-grid',
    tab: 'quality',
    placement: 'top',
  },
  {
    id: 'step-validation',
    title: '100% Enumerable-Instance Proofs',
    content: 'Every metric is an interactive Tabulator table. Click "Verify →" on any row to open the 5-section drawer with mathematical formulas, exact observations, and live client-side recomputation!',
    targetSelector: '#validation-table-mount',
    tab: 'validation',
    placement: 'top',
  },
];

export const PAGE_TOUR_STEPS: Record<TabId, TourStep[]> = {
  overview: [
    {
      id: 'page-ov-kpis',
      title: 'Macro Indicators',
      content: 'Review macro indicators including Total Return, Maximum Drawdown, and Hourly Win Rate evaluated across 60k+ bars.',
      targetSelector: '.kpis',
      placement: 'bottom',
    },
    {
      id: 'page-ov-tendencies',
      title: 'Seasonality Tendencies',
      content: 'Quick overview of historically optimal and challenging trading hours and days of the week.',
      targetSelector: '.grid2',
      placement: 'top',
    },
  ],
  price: [
    {
      id: 'page-pr-chart',
      title: 'Interactive Price Action',
      content: 'Pan and zoom through 6+ years of 1h candlestick data. Hover anywhere to inspect high, low, open, close, and volume.',
      targetSelector: '#price-chart',
      placement: 'top',
    },
    {
      id: 'page-pr-scale',
      title: 'Scale & Timezone Controls',
      content: 'Switch between Linear and Logarithmic price axes, and view UTC/IST market alignment.',
      targetSelector: '.ctl',
      placement: 'bottom',
    },
  ],
  seasonality: [
    {
      id: 'page-se-metric',
      title: 'Metric Selector',
      content: 'Toggle analysis across Mean Return (bps), Volatility (bps), Taker Buy Ratio (%), and Volume (BTC).',
      targetSelector: '#seasonality-metric-select',
      placement: 'bottom',
    },
    {
      id: 'page-se-chart',
      title: 'Hourly & Day-of-Week Tendencies',
      content: 'Observe statistical tendencies. Green bars represent positive averages; amber/red represent negative.',
      targetSelector: '#seasonality-chart',
      placement: 'top',
    },
  ],
  heatmap: [
    {
      id: 'page-hm-matrix',
      title: '168-Cell Weekly Microstructure',
      content: 'Every cell represents a specific hour of the trading week. Click any cell to inspect its underlying sample size and exact historical bars.',
      targetSelector: '#heatmap-chart',
      placement: 'top',
    },
    {
      id: 'page-hm-controls',
      title: 'Bivariate Metrics',
      content: 'Switch metrics between Mean Return, Volatility, Taker Ratio, and Volume.',
      targetSelector: '#heatmap-metric-select',
      placement: 'bottom',
    },
  ],
  volatility: [
    {
      id: 'page-vo-moments',
      title: 'Statistical Moments & Quantiles',
      content: 'Quantified distribution metrics: Sample Std Dev, Skewness, and Excess Kurtosis fat-tail indicators.',
      targetSelector: '#moments-panel',
      placement: 'left',
    },
    {
      id: 'page-vo-slider',
      title: 'Rolling Volatility Window',
      content: 'Adjust the rolling window from 7 days (168h) to 90 days to explore structural volatility regimes.',
      targetSelector: '#rolling-window-slider',
      placement: 'bottom',
    },
  ],
  flow: [
    {
      id: 'page-fl-cvd',
      title: 'Cumulative Volume Delta (CVD)',
      content: 'Tracks running net aggressive buying vs selling: Σ(2 · taker_buy_volume − volume) in BTC.',
      targetSelector: '#cum-delta-chart',
      placement: 'bottom',
    },
    {
      id: 'page-fl-tbr',
      title: 'Hourly Taker Buy Ratio',
      content: 'Proportion of volume initiated by market buys across each UTC hour. Spikes frequently align with perpetual funding rate settlement boundaries.',
      targetSelector: '#hourly-flow-chart',
      placement: 'top',
    },
  ],
  calendar: [
    {
      id: 'page-ca-grid',
      title: 'Monthly Return Matrix',
      content: 'Year-by-month return matrix with color intensity shading. Click any monthly cell to inspect its underlying bars.',
      targetSelector: '.cal.data-table',
      placement: 'top',
    },
    {
      id: 'page-ca-drawdown',
      title: 'Historical Drawdown Trajectory',
      content: 'Continuous underwater peak-to-trough decline curve across all 60k hourly closes.',
      targetSelector: '#drawdown-chart',
      placement: 'top',
    },
  ],
  quality: [
    {
      id: 'page-qu-kpis',
      title: 'Audit Metrics',
      content: 'Ingestion coverage ratio, checksum audits, deduplicated rows, and zero-volume bar validation.',
      targetSelector: '.kpis',
      placement: 'bottom',
    },
    {
      id: 'page-qu-provenance',
      title: 'Release Provenance',
      content: 'Cryptographic commit SHA, build timestamp, and static Parquet release lineage.',
      targetSelector: '.bento-grid',
      placement: 'top',
    },
  ],
  validation: [
    {
      id: 'page-va-domains',
      title: 'Validation Domains',
      content: 'Switch between 8 validation domains: KPIs, Seasonality, Heatmap, Volatility, Flow, Calendar, Raw Bars, and Quality.',
      targetSelector: '.validation-domain-bar',
      placement: 'bottom',
    },
    {
      id: 'page-va-table',
      title: 'Interactive Tabulator Table',
      content: 'Sort, filter, and export exact underlying observation sets to Excel or RFC4180 CSV.',
      targetSelector: '#validation-table-mount',
      placement: 'top',
    },
  ],
};

export class TourEngine {
  private activeSteps: TourStep[] = [];
  private currentStepIndex = -1;
  private callbacks: TourCallbacks;
  private overlayEl: HTMLElement | null = null;
  private popoverEl: HTMLElement | null = null;
  private spotlightSvg: SVGSVGElement | null = null;
  private spotlightRect: SVGRectElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(callbacks: TourCallbacks) {
    this.callbacks = callbacks;
  }

  public isRunning(): boolean {
    return this.currentStepIndex >= 0 && this.currentStepIndex < this.activeSteps.length;
  }

  public shouldAutoStartGlobal(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY_GLOBAL_TOUR) !== 'true';
    } catch {
      return false;
    }
  }

  public markGlobalTourCompleted(): void {
    try {
      localStorage.setItem(STORAGE_KEY_GLOBAL_TOUR, 'true');
    } catch {
      // ignore
    }
  }

  public startGlobalTour(): void {
    this.start(GLOBAL_TOUR_STEPS, true);
  }

  public startPageTour(tab: TabId): void {
    const steps = PAGE_TOUR_STEPS[tab];
    if (steps && steps.length > 0) {
      this.start(steps, false);
    }
  }

  public start(steps: TourStep[], isGlobal = false): void {
    this.end();
    if (!steps || steps.length === 0) return;

    this.activeSteps = steps;
    this.currentStepIndex = 0;
    this.createDom();
    this.renderCurrentStep(isGlobal);
  }

  public next(isGlobal = false): void {
    if (this.currentStepIndex < this.activeSteps.length - 1) {
      this.currentStepIndex++;
      this.renderCurrentStep(isGlobal);
    } else {
      this.end(isGlobal);
    }
  }

  public prev(isGlobal = false): void {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.renderCurrentStep(isGlobal);
    }
  }

  public end(markGlobalComplete = false): void {
    if (markGlobalComplete) {
      this.markGlobalTourCompleted();
    }
    this.activeSteps = [];
    this.currentStepIndex = -1;
    this.destroyDom();
  }

  private createDom(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.id = 'tour-overlay';

    // SVG spotlight mask
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tour-spotlight-svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
    mask.setAttribute('id', 'tour-spotlight-mask');

    const maskBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    maskBg.setAttribute('width', '100%');
    maskBg.setAttribute('height', '100%');
    maskBg.setAttribute('fill', '#ffffff');

    const cutOut = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    cutOut.setAttribute('id', 'tour-cutout');
    cutOut.setAttribute('fill', '#000000');
    cutOut.setAttribute('rx', '8');
    cutOut.setAttribute('ry', '8');

    mask.appendChild(maskBg);
    mask.appendChild(cutOut);
    defs.appendChild(mask);
    svg.appendChild(defs);

    const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    backdrop.setAttribute('width', '100%');
    backdrop.setAttribute('height', '100%');
    backdrop.setAttribute('fill', 'rgba(12, 10, 7, 0.75)');
    backdrop.setAttribute('mask', 'url(#tour-spotlight-mask)');
    backdrop.style.pointerEvents = 'auto';

    backdrop.addEventListener('click', () => {
      this.end();
    });

    svg.appendChild(backdrop);
    overlay.appendChild(svg);

    // Floating popover card
    const popover = document.createElement('div');
    popover.className = 'tour-popover';
    popover.id = 'tour-popover';
    overlay.appendChild(popover);

    document.body.appendChild(overlay);

    this.overlayEl = overlay;
    this.popoverEl = popover;
    this.spotlightSvg = svg;
    this.spotlightRect = cutOut;

    // Keyboard navigation
    this.keydownHandler = (e: KeyboardEvent) => {
      if (!this.isRunning()) return;
      if (e.key === 'Escape') {
        this.end();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        this.next();
      } else if (e.key === 'ArrowLeft') {
        this.prev();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    window.addEventListener('resize', this.onResizeOrScroll);
    window.addEventListener('scroll', this.onResizeOrScroll, true);
  }

  private onResizeOrScroll = (): void => {
    if (!this.isRunning()) return;
    this.updatePosition();
  };

  private async renderCurrentStep(isGlobal: boolean): Promise<void> {
    const step = this.activeSteps[this.currentStepIndex];
    if (!step || !this.popoverEl) return;

    // 1. Switch tab if specified
    if (step.tab) {
      this.callbacks.onTabChange(step.tab);
    }

    if (step.beforeMount) {
      await Promise.resolve(step.beforeMount());
    }

    // Wait for DOM to stabilize
    await new Promise((resolve) => setTimeout(resolve, 180));

    // 2. Position spotlight & popover
    this.updatePosition();

    // 3. Render Popover Content
    const isFirst = this.currentStepIndex === 0;
    const isLast = this.currentStepIndex === this.activeSteps.length - 1;
    const currentNum = this.currentStepIndex + 1;
    const totalNum = this.activeSteps.length;

    this.popoverEl.innerHTML = `
      <div class="tour-popover-header">
        <span class="badge tour-step-badge">Step ${currentNum} of ${totalNum}</span>
        <button type="button" class="tour-close-btn" id="tour-btn-close" aria-label="Close Tour">✕</button>
      </div>
      <div class="tour-popover-body">
        <h4 class="tour-title">${escapeHtml(step.title)}</h4>
        <p class="tour-desc">${escapeHtml(step.content)}</p>
      </div>
      <div class="tour-popover-footer">
        <button type="button" class="btn btn-sm btn-secondary tour-skip-btn" id="tour-btn-skip">Skip</button>
        <div style="display: flex; gap: 6px;">
          ${!isFirst ? `<button type="button" class="btn btn-sm btn-secondary tour-prev-btn" id="tour-btn-prev">Back</button>` : ''}
          <button type="button" class="btn btn-sm btn-primary tour-next-btn" id="tour-btn-next">
            ${isLast ? 'Finish ✦' : 'Next →'}
          </button>
        </div>
      </div>
    `;

    // Button event listeners
    this.popoverEl.querySelector('#tour-btn-close')?.addEventListener('click', () => this.end(isGlobal));
    this.popoverEl.querySelector('#tour-btn-skip')?.addEventListener('click', () => this.end(isGlobal));
    this.popoverEl.querySelector('#tour-btn-prev')?.addEventListener('click', () => this.prev(isGlobal));
    this.popoverEl.querySelector('#tour-btn-next')?.addEventListener('click', () => this.next(isGlobal));
  }

  private updatePosition(): void {
    if (!this.isRunning() || !this.popoverEl || !this.spotlightRect) return;

    const step = this.activeSteps[this.currentStepIndex];
    if (!step) return;

    const targetEl = document.querySelector<HTMLElement>(step.targetSelector);
    if (!targetEl) {
      // Fallback to center screen if target is missing
      this.spotlightRect.setAttribute('x', '0');
      this.spotlightRect.setAttribute('y', '0');
      this.spotlightRect.setAttribute('width', '0');
      this.spotlightRect.setAttribute('height', '0');
      this.positionPopoverCenter();
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const pad = 6;
    const x = Math.max(0, rect.left - pad);
    const y = Math.max(0, rect.top - pad);
    const w = Math.min(window.innerWidth - x, rect.width + pad * 2);
    const h = Math.min(window.innerHeight - y, rect.height + pad * 2);

    // Update SVG mask cut-out
    this.spotlightRect.setAttribute('x', String(x));
    this.spotlightRect.setAttribute('y', String(y));
    this.spotlightRect.setAttribute('width', String(w));
    this.spotlightRect.setAttribute('height', String(h));

    // Scroll element into view if offscreen
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Position Popover
    const popoverW = Math.min(360, window.innerWidth - 32);
    this.popoverEl.style.width = `${popoverW}px`;
    const popoverH = this.popoverEl.offsetHeight || 190;

    let top = rect.bottom + 12;
    let left = rect.left + rect.width / 2 - popoverW / 2;

    // Viewport bounds clamping
    if (top + popoverH > window.innerHeight - 16) {
      top = Math.max(16, rect.top - popoverH - 12);
    }
    if (left < 16) left = 16;
    if (left + popoverW > window.innerWidth - 16) {
      left = window.innerWidth - popoverW - 16;
    }

    this.popoverEl.style.top = `${top}px`;
    this.popoverEl.style.left = `${left}px`;
  }

  private positionPopoverCenter(): void {
    if (!this.popoverEl) return;
    const popoverW = Math.min(360, window.innerWidth - 32);
    this.popoverEl.style.width = `${popoverW}px`;
    this.popoverEl.style.top = '50%';
    this.popoverEl.style.left = '50%';
    this.popoverEl.style.transform = 'translate(-50%, -50%)';
  }

  private destroyDom(): void {
    if (this.keydownHandler && typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResizeOrScroll);
      window.removeEventListener('scroll', this.onResizeOrScroll, true);
    }

    this.overlayEl?.remove();
    this.overlayEl = null;
    this.popoverEl = null;
    this.spotlightSvg = null;
    this.spotlightRect = null;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
