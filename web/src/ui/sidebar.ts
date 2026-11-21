/**
 * Sidebar navigation component with collapse support.
 */

import type { TabId, Theme } from '../types';

export interface SidebarCallbacks {
  onTabChange(tab: TabId): void;
  onThemeChange(theme: Theme): void;
}

const NAV_ITEMS: Array<{ tab: TabId; label: string; icon: string }> = [
  {
    tab: 'overview',
    label: 'Overview',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg>`,
  },
  {
    tab: 'price',
    label: 'Price',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="2" x2="4" y2="14"/><rect x="2" y="5" width="4" height="5" rx="0.5"/><line x1="12" y1="2" x2="12" y2="14"/><rect x="10" y="6" width="4" height="4" rx="0.5"/></svg>`,
  },
  {
    tab: 'seasonality',
    label: 'Seasonality',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 9 Q3.5 4 6 9 Q8.5 14 11 9 Q13.5 4 15 6"/></svg>`,
  },
  {
    tab: 'heatmap',
    label: '7×24 Heatmap',
    icon: `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="4" height="4" rx="0.5" opacity="0.3"/><rect x="6" y="1" width="4" height="4" rx="0.5" opacity="1"/><rect x="11" y="1" width="4" height="4" rx="0.5" opacity="0.5"/><rect x="1" y="6" width="4" height="4" rx="0.5" opacity="0.8"/><rect x="6" y="6" width="4" height="4" rx="0.5" opacity="0.2"/><rect x="11" y="6" width="4" height="4" rx="0.5" opacity="0.9"/><rect x="1" y="11" width="4" height="4" rx="0.5" opacity="0.4"/><rect x="6" y="11" width="4" height="4" rx="0.5" opacity="0.6"/><rect x="11" y="11" width="4" height="4" rx="0.5" opacity="0.1"/></svg>`,
  },
  {
    tab: 'volatility',
    label: 'Volatility',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,11 4,6 7,13 10,3 13,8 15,6"/></svg>`,
  },
  {
    tab: 'flow',
    label: 'Order Flow',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,12 5,7 9,10 15,3"/><polyline points="11,3 15,3 15,7"/></svg>`,
  },
  {
    tab: 'calendar',
    label: 'Calendar & Risk',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="11" rx="1.5"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="5.5" y1="1.5" x2="5.5" y2="4.5"/><line x1="10.5" y1="1.5" x2="10.5" y2="4.5"/></svg>`,
  },
  {
    tab: 'quality',
    label: 'Data Quality',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1.5 L14.5 4.5 L14.5 8.5 C14.5 11.5 11.5 14 8 15 C4.5 14 1.5 11.5 1.5 8.5 L1.5 4.5 Z"/><polyline points="5.5,8 7.5,10 11,6"/></svg>`,
  },
  {
    tab: 'validation',
    label: 'Validation',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="2" width="13" height="12" rx="1.5"/><line x1="1.5" y1="6" x2="14.5" y2="6"/><line x1="6" y1="6" x2="6" y2="14"/><line x1="10.5" y1="6" x2="10.5" y2="14"/><line x1="1.5" y1="10" x2="14.5" y2="10"/></svg>`,
  },
];

const CHEVRON_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="10,4 6,8 10,12"/></svg>`;

const COLLAPSED_KEY = 'btc_sidebar_collapsed';

export function createSidebar(
  container: HTMLElement,
  initialTab: TabId,
  initialTheme: Theme,
  callbacks: SidebarCallbacks
): {
  setActiveTab(tab: TabId): void;
  setTheme(theme: Theme): void;
} {
  // Build nav items HTML
  const navItemsHtml = NAV_ITEMS.map(({ tab, label, icon }) => `
    <button class="sidebar-nav-item${tab === initialTab ? ' active' : ''}" data-tab="${tab}" title="${label}">
      <span class="nav-icon">${icon}</span>
      <span class="nav-label">${label}</span>
    </button>
  `).join('');

  container.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <div class="sidebar-logo-mark">₿</div>
        <div class="sidebar-brand-text">
          <span class="sidebar-brand-name">BTC Analytics</span>
          <span class="sidebar-brand-sub">1h · Binance Futures</span>
        </div>
      </div>
      <button class="sidebar-collapse-btn" id="sidebar-collapse-btn" title="Collapse">
        ${CHEVRON_SVG}
      </button>
    </div>
    <nav class="sidebar-nav">
      <span class="sidebar-section-label">Analytics</span>
      ${navItemsHtml}
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-theme-row">
        <span class="theme-label">Theme</span>
        <div class="theme-toggle-group">
          <button class="theme-btn${initialTheme === 'dark' ? ' active' : ''}" data-theme-val="dark" title="Dark Theme">🌙 <span class="theme-text">Dark</span></button>
          <button class="theme-btn${initialTheme === 'light' ? ' active' : ''}" data-theme-val="light" title="Light Theme">☀️ <span class="theme-text">Light</span></button>
        </div>
      </div>
    </div>
  `;

  // Restore collapsed state
  const sidebar = document.getElementById('app-sidebar');
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    if (saved === 'true' && sidebar) {
      sidebar.setAttribute('data-collapsed', 'true');
    }
  } catch {
    // ignore
  }

  // Collapse button
  const collapseBtn = container.querySelector<HTMLButtonElement>('#sidebar-collapse-btn');
  collapseBtn?.addEventListener('click', () => {
    const sb = document.getElementById('app-sidebar');
    if (!sb) return;
    const collapsed = sb.getAttribute('data-collapsed') === 'true';
    const next = !collapsed;
    sb.setAttribute('data-collapsed', String(next));
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // ignore
    }
  });

  // Nav item clicks
  const navItems = container.querySelectorAll<HTMLButtonElement>('.sidebar-nav-item');
  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as TabId;
      navItems.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      callbacks.onTabChange(tab);
    });
  });

  // Theme buttons
  const themeButtons = container.querySelectorAll<HTMLButtonElement>('.theme-btn');
  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.themeVal as Theme;
      themeButtons.forEach(b => b.classList.toggle('active', b.dataset.themeVal === theme));
      callbacks.onThemeChange(theme);
    });
  });

  return {
    setActiveTab(tab: TabId) {
      navItems.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    },
    setTheme(theme: Theme) {
      themeButtons.forEach(b => b.classList.toggle('active', b.dataset.themeVal === theme));
    },
  };
}
