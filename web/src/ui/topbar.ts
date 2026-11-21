/**
 * Topbar component: page title, subtitle, and dataset stat pills.
 */

export interface TopbarStats {
  totalBars: number;
  coveragePct: number;
  dateRange: string;      // e.g. "Jan 2020 – Nov 2026"
  latestPrice: number | null;
  dataThrough: string;    // e.g. "Nov 19 23:00 UTC"
  refreshedAt: string;    // e.g. "Nov 21 08:00 UTC"
  isStale?: boolean;
}

function formatBars(n: number): string {
  return n.toLocaleString('en-US');
}

function formatPrice(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function coverageClass(pct: number): string {
  if (pct >= 99) return 'positive';
  if (pct >= 95) return 'warning';
  return 'negative';
}

function pill(value: string, label: string, extraClass?: string): string {
  return `<div class="topbar-stat">
    <span class="topbar-stat-value${extraClass ? ' ' + extraClass : ''}">${value}</span>
    <span class="topbar-stat-label">${label}</span>
  </div>`;
}

export function createTopbar(
  container: HTMLElement,
  initialPageInfo: { title: string; subtitle: string }
): {
  updatePageInfo(title: string, subtitle: string): void;
  updateStats(stats: TopbarStats): void;
} {
  container.innerHTML = `
    <div class="topbar-left">
      <div class="topbar-page-title" id="topbar-page-title">${initialPageInfo.title}</div>
      <div class="topbar-page-sub" id="topbar-page-sub">${initialPageInfo.subtitle}</div>
    </div>
    <div class="topbar-stats" id="topbar-stats"></div>
  `;

  const titleEl = container.querySelector<HTMLElement>('#topbar-page-title')!;
  const subEl = container.querySelector<HTMLElement>('#topbar-page-sub')!;
  const statsEl = container.querySelector<HTMLElement>('#topbar-stats')!;

  return {
    updatePageInfo(title: string, subtitle: string) {
      titleEl.textContent = title;
      subEl.textContent = subtitle;
    },

    updateStats(stats: TopbarStats) {
      const parts: string[] = [];

      parts.push(pill(formatBars(stats.totalBars) + ' bars', 'DATASET'));
      parts.push('<div class="topbar-divider"></div>');

      const covPct = stats.coveragePct.toFixed(2) + '%';
      parts.push(pill(covPct, 'COVERAGE', coverageClass(stats.coveragePct)));
      parts.push('<div class="topbar-divider"></div>');

      parts.push(pill(stats.dateRange, 'RANGE'));
      parts.push('<div class="topbar-divider"></div>');

      if (stats.latestPrice !== null) {
        parts.push(pill(formatPrice(stats.latestPrice), 'LATEST PRICE'));
        parts.push('<div class="topbar-divider"></div>');
      }

      parts.push(pill(stats.dataThrough, 'DATA THROUGH'));
      parts.push('<div class="topbar-divider"></div>');

      parts.push(pill(stats.refreshedAt, 'REFRESHED', stats.isStale ? 'warning' : 'positive'));

      statsEl.innerHTML = parts.join('');
    },
  };
}
