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
  if (pct >= 99) return 'good positive';
  if (pct >= 95) return 'warn warning';
  return 'bad negative';
}

function pill(value: string, label: string, extraClass?: string): string {
  return `<div class="pill topbar-stat${extraClass ? ' ' + extraClass : ''}">
    <b class="topbar-stat-value">${value}</b>
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
  container.className = 'topbar app-topbar';
  container.innerHTML = `
    <button class="menu" id="menu-toggle" aria-label="Toggle navigation menu">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
        <path d="M2 4h12M2 8h12M2 12h12"/>
      </svg>
    </button>
    <div class="tb-title topbar-left">
      <b class="topbar-page-title" id="topbar-page-title">${initialPageInfo.title}</b>
      <small class="topbar-page-sub" id="topbar-page-sub">${initialPageInfo.subtitle}</small>
    </div>
    <div class="pills topbar-stats" id="topbar-stats"></div>
  `;

  const menuBtn = container.querySelector<HTMLButtonElement>('#menu-toggle');
  menuBtn?.addEventListener('click', () => {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
      sidebar.classList.toggle('on');
      sidebar.classList.toggle('open');
    }
  });

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

      parts.push(pill(formatBars(stats.totalBars), 'DATASET'));

      const covPct = stats.coveragePct.toFixed(2) + '%';
      parts.push(pill(covPct, 'COVERAGE', coverageClass(stats.coveragePct)));

      parts.push(pill(stats.dateRange, 'RANGE'));

      if (stats.latestPrice !== null) {
        parts.push(pill(formatPrice(stats.latestPrice), 'LATEST PRICE'));
      }

      parts.push(pill(stats.dataThrough, 'DATA THROUGH'));

      parts.push(pill(stats.refreshedAt, 'REFRESHED', stats.isStale ? 'warn warning' : 'good positive'));

      statsEl.innerHTML = parts.join('');
    },
  };
}
