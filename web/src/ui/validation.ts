/**
 * Validation Section View (Phase V1).
 * "Enumerable-Instance Validation Tables"
 *
 * Exposes every KPI and aggregate as interactive Tabulator tables with
 * exact instance drill-downs and live plain-language recompute proofs.
 */

import type { KlineRow, Meta, QualityReport, ValidationDomain } from '../types';
import { getAllMetricDefs, getMetricDef } from '../verify/registry';
import { computeSeasonality, DOW_LABELS } from '../stats/aggregations';
import { createValidationTable, type ValidationTableInstance } from '../validation/table';
import { selectInstances } from '../validation/instances';
import { openInspectDrawer } from '../verify/drawer';
import type { ColumnDefinition } from 'tabulator-tables';

type SeasonalityBucket = 'hour' | 'dow';

export interface ValidationViewContext {
  data: KlineRow[];
  meta: Meta | null;
  qualityData: QualityReport | null;
  startMs?: number;
  endMs?: number;
  initialDomain?: ValidationDomain;
}

const DOMAINS: Array<{ id: ValidationDomain; label: string; desc: string }> = [
  { id: 'kpis', label: 'KPIs', desc: 'Summary scalar indicators and macro metrics' },
  { id: 'seasonality', label: 'Seasonality', desc: 'Wide table across all 6 metrics by Hour & Day-of-Week' },
  { id: 'raw', label: 'Raw Data', desc: 'All 60k raw 1h OHLCV bars across all 15 parquet columns' },
  { id: 'heatmap', label: 'Heatmap', desc: '7×24 day-hour matrix cells' },
  { id: 'volatility', label: 'Volatility', desc: 'Distribution moments, histogram bins, and rolling vol series' },
  { id: 'flow', label: 'Flow', desc: 'Hourly taker flow and cumulative taker delta (CVD) series' },
  { id: 'calendar', label: 'Calendar', desc: 'Monthly returns grid, YTD returns, and drawdown series' },
  { id: 'quality', label: 'Quality', desc: 'Exchange gaps, coverage, and release provenance' },
];

/**
 * Formats a millisecond timestamp to YYYY-MM-DD HH:mm UTC.
 */
function formatUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00`;
}

/**
 * Creates and mounts the Validation view.
 */
export function createValidationView(container: HTMLElement, getContext: () => ValidationViewContext): {
  destroy(): void;
  setDomain(domain: ValidationDomain): void;
} {
  let currentDomain: ValidationDomain = getContext().initialDomain || 'kpis';
  let activeTable: ValidationTableInstance | null = null;
  let seasonalityBucket: SeasonalityBucket = 'hour';

  container.innerHTML = `
    <div class="page-wrapper tab-enter">
      <!-- Section Header -->
      <div class="page-header">
        <div class="page-header-left">
          <h2 class="page-title">Instance Validation Tables</h2>
          <p class="page-subtitle">Inspect every metric as an interactive table, drill down to exact underlying bars, and verify transparent recomputations.</p>
        </div>
      </div>

      <!-- Domain Switcher (Segmented Control) -->
      <div class="validation-domain-bar" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
        ${DOMAINS.map((d) => `
          <button type="button" class="btn btn-sm btn-domain-tab ${d.id === currentDomain ? 'btn-primary active' : 'btn-secondary'}" data-domain="${d.id}" title="${d.desc}">
            ${d.label}
          </button>
        `).join('')}
      </div>

      <!-- Domain Description Banner -->
      <div class="validation-domain-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div>
          <h3 class="validation-domain-title" id="validation-domain-title" style="margin: 0; font-size: var(--text-md); font-weight: 600;"></h3>
          <p class="validation-domain-desc" id="validation-domain-desc" style="margin: 2px 0 0; font-size: var(--text-xs); color: var(--text-muted);"></p>
        </div>
        <div id="validation-domain-controls" style="display: flex; gap: 8px; align-items: center;"></div>
      </div>

      <!-- Table Container -->
      <div id="validation-table-mount" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; min-height: 400px;"></div>
    </div>
  `;

  const mountEl = container.querySelector<HTMLElement>('#validation-table-mount')!;
  const titleEl = container.querySelector<HTMLElement>('#validation-domain-title')!;
  const descEl = container.querySelector<HTMLElement>('#validation-domain-desc')!;
  const controlsEl = container.querySelector<HTMLElement>('#validation-domain-controls')!;

  function updateDomainHeader() {
    const d = DOMAINS.find((item) => item.id === currentDomain)!;
    titleEl.textContent = d.label;
    descEl.textContent = d.desc;

    // Domain button states
    container.querySelectorAll<HTMLButtonElement>('.btn-domain-tab').forEach((btn) => {
      const isCurrent = btn.dataset.domain === currentDomain;
      btn.className = `btn btn-sm btn-domain-tab ${isCurrent ? 'btn-primary active' : 'btn-secondary'}`;
    });
  }

  function renderCurrentDomain() {
    if (activeTable) {
      activeTable.destroy();
      activeTable = null;
    }
    controlsEl.innerHTML = '';
    updateDomainHeader();

    const ctx = getContext();
    const rows = ctx.data;

    switch (currentDomain) {
      case 'raw':
        renderRawDataDomain(rows, ctx);
        break;
      case 'kpis':
        renderKpisDomain(rows, ctx);
        break;
      case 'seasonality':
        renderSeasonalityDomain(rows, ctx);
        break;
      default:
        // Domains for Phase V2
        renderUpcomingDomainPlaceholder(currentDomain);
        break;
    }
  }

  // 1. Raw Data Domain: All 60k rows with 15 parquet columns
  function renderRawDataDomain(rows: KlineRow[], ctx: ValidationViewContext) {
    const columns: ColumnDefinition[] = [
      {
        title: 'Open Time (UTC)',
        field: 'open_time_ms',
        formatter: (cell) => `<span class="font-mono text-xs">${formatUtc(cell.getValue())}</span>`,
        headerFilter: 'input',
        width: 150,
      },
      { title: 'Open', field: 'open', hozAlign: 'right', formatter: (c) => Number(c.getValue()).toFixed(1) },
      { title: 'High', field: 'high', hozAlign: 'right', formatter: (c) => Number(c.getValue()).toFixed(1) },
      { title: 'Low', field: 'low', hozAlign: 'right', formatter: (c) => Number(c.getValue()).toFixed(1) },
      { title: 'Close', field: 'close', hozAlign: 'right', formatter: (c) => Number(c.getValue()).toFixed(1) },
      { title: 'Volume (BTC)', field: 'volume', hozAlign: 'right', formatter: (c) => Number(c.getValue()).toFixed(2) },
      { title: 'Quote Vol', field: 'quote_volume', hozAlign: 'right', visible: false },
      { title: 'Trades', field: 'trades', hozAlign: 'right', formatter: (c) => Number(c.getValue()).toLocaleString() },
      { title: 'Taker Vol (BTC)', field: 'taker_buy_volume', hozAlign: 'right', visible: false },
      { title: 'Taker Quote Vol', field: 'taker_buy_quote_volume', hozAlign: 'right', visible: false },
      {
        title: 'Log Ret (bps)',
        field: 'log_ret',
        hozAlign: 'right',
        formatter: (c) => {
          const v = c.getValue();
          if (v === null || v === undefined) return '<span class="text-muted">—</span>';
          const bps = Number(v) * 10000;
          const cls = bps >= 0 ? 'text-positive' : 'text-negative';
          return `<span class="${cls} font-mono">${bps.toFixed(2)}</span>`;
        },
      },
      { title: 'Hour', field: 'hour', hozAlign: 'center', width: 70 },
      {
        title: 'DOW',
        field: 'dow',
        hozAlign: 'center',
        width: 75,
        formatter: (c) => DOW_LABELS[c.getValue()] || String(c.getValue()),
      },
      {
        title: 'Taker Ratio',
        field: 'taker_buy_ratio',
        hozAlign: 'right',
        formatter: (c) => (c.getValue() !== null ? Number(c.getValue()).toFixed(4) : '—'),
      },
      {
        title: 'H-L Range (bps)',
        field: 'hl_range',
        hozAlign: 'right',
        formatter: (c) => `<span class="font-mono">${(Number(c.getValue()) * 10000).toFixed(1)}</span>`,
      },
      {
        title: 'Inspect',
        field: 'instances_view',
        hozAlign: 'center',
        width: 80,
        formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 11px;">Inspect</button>`,
      },
    ];

    activeTable = createValidationTable(mountEl, {
      data: rows,
      columns,
      exportFilename: 'raw-data-klines',
      sheetName: 'RawData',
      pageSize: 25,
      onRowClick: (row) => {
        const def = getMetricDef('kpi.total_bars')!;
        openInspectDrawer({
          defId: def.id,
          data: rows,
          meta: ctx.meta,
          qualityData: ctx.qualityData,
          currentTab: 'validation',
          startMs: row.open_time_ms,
          endMs: row.open_time_ms + 3600000,
        });
      },
    });
  }

  // 2. KPIs Domain: All scalar definitions from registry
  function renderKpisDomain(rows: KlineRow[], ctx: ValidationViewContext) {
    const defs = getAllMetricDefs().filter((d) => d.kind === 'scalar');

    const tableData = defs.map((def) => {
      const res = def.compute(rows, {}, { meta: ctx.meta, qualityData: ctx.qualityData });
      const rawVal = res.kind === 'scalar' ? res.value : null;
      const formatted = def.format ? def.format(rawVal) : String(rawVal);

      return {
        id: def.id,
        label: def.label,
        rawValue: rawVal,
        value: formatted,
        unit: def.unit,
        n: res.kind === 'scalar' ? res.n : rows.length,
        formula: def.formula,
      };
    });

    const columns: ColumnDefinition[] = [
      {
        title: 'KPI Definition',
        field: 'label',
        formatter: (c) => `<strong style="color: var(--text-primary);">${c.getValue()}</strong>`,
        widthGrow: 2,
      },
      {
        title: 'Value',
        field: 'value',
        hozAlign: 'right',
        formatter: (c) => `<span class="font-mono font-semibold" style="font-size: 13px;">${c.getValue()}</span>`,
      },
      { title: 'Unit', field: 'unit', hozAlign: 'center', width: 90 },
      {
        title: 'Observations (n)',
        field: 'n',
        hozAlign: 'right',
        width: 140,
        formatter: (c) => `<span class="font-mono text-muted">${Number(c.getValue()).toLocaleString('en-US')}</span>`,
      },
      {
        title: 'Instances',
        field: 'instances_view',
        hozAlign: 'center',
        width: 110,
        formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">View Math &rarr;</button>`,
      },
    ];

    activeTable = createValidationTable(mountEl, {
      data: tableData,
      columns,
      pagination: false,
      exportFilename: 'kpi-scalars-validation',
      sheetName: 'KPIs',
      onRowClick: (row) => {
        openInspectDrawer({
          defId: row.id,
          data: rows,
          meta: ctx.meta,
          qualityData: ctx.qualityData,
          currentTab: 'validation',
        });
      },
    });
  }

  // 3. Seasonality Domain: Wide table with 6 metrics
  function renderSeasonalityDomain(rows: KlineRow[], ctx: ValidationViewContext) {
    // Add sub-toggle for Hour vs Day-of-Week
    controlsEl.innerHTML = `
      <div class="seasonality-bucket-toggle" style="display: flex; gap: 4px; background: var(--bg-surface-elevated); padding: 2px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <button type="button" class="btn btn-sm ${seasonalityBucket === 'hour' ? 'btn-primary' : 'btn-ghost'}" id="btn-seasonality-hour">Hour (0–23 UTC)</button>
        <button type="button" class="btn btn-sm ${seasonalityBucket === 'dow' ? 'btn-primary' : 'btn-ghost'}" id="btn-seasonality-dow">Day of Week (Mon–Sun)</button>
      </div>
    `;

    controlsEl.querySelector('#btn-seasonality-hour')?.addEventListener('click', () => {
      seasonalityBucket = 'hour';
      renderSeasonalityDomain(rows, ctx);
    });
    controlsEl.querySelector('#btn-seasonality-dow')?.addEventListener('click', () => {
      seasonalityBucket = 'dow';
      renderSeasonalityDomain(rows, ctx);
    });

    const meanRets = computeSeasonality(rows, seasonalityBucket, 'mean_return');
    const vols = computeSeasonality(rows, seasonalityBucket, 'volatility');
    const winRates = computeSeasonality(rows, seasonalityBucket, 'win_rate');
    const volumes = computeSeasonality(rows, seasonalityBucket, 'total_volume');
    const takerRatios = computeSeasonality(rows, seasonalityBucket, 'taker_buy_ratio');
    const ranges = computeSeasonality(rows, seasonalityBucket, 'mean_hl_range');

    const bucketCount = seasonalityBucket === 'hour' ? 24 : 7;
    const tableData: Array<Record<string, any>> = [];

    for (let b = 0; b < bucketCount; b++) {
      const label = seasonalityBucket === 'hour' ? `${String(b).padStart(2, '0')}:00 UTC` : DOW_LABELS[b];
      const n = meanRets.find((m) => m.bucket === b)?.n || 0;

      tableData.push({
        bucket: b,
        bucketLabel: label,
        mean_return: meanRets.find((m) => m.bucket === b)?.value ?? 0,
        volatility: vols.find((m) => m.bucket === b)?.value ?? 0,
        win_rate: winRates.find((m) => m.bucket === b)?.value ?? 0,
        total_volume: volumes.find((m) => m.bucket === b)?.value ?? 0,
        taker_buy_ratio: takerRatios.find((m) => m.bucket === b)?.value ?? 0,
        mean_hl_range: ranges.find((m) => m.bucket === b)?.value ?? 0,
        n,
      });
    }

    const columns: ColumnDefinition[] = [
      {
        title: seasonalityBucket === 'hour' ? 'Hour (UTC)' : 'Day of Week',
        field: 'bucketLabel',
        formatter: (c) => `<strong class="font-mono">${c.getValue()}</strong>`,
        width: 140,
      },
      {
        title: 'Mean Ret (bps)',
        field: 'mean_return',
        hozAlign: 'right',
        formatter: (c) => {
          const v = Number(c.getValue());
          const cls = v >= 0 ? 'text-positive' : 'text-negative';
          return `<span class="${cls} font-mono">${v >= 0 ? '+' : ''}${v.toFixed(2)}</span>`;
        },
      },
      {
        title: 'Volatility (bps)',
        field: 'volatility',
        hozAlign: 'right',
        formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toFixed(2)}</span>`,
      },
      {
        title: 'Win Rate (%)',
        field: 'win_rate',
        hozAlign: 'right',
        formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toFixed(1)}%</span>`,
      },
      {
        title: 'Total Vol (BTC)',
        field: 'total_volume',
        hozAlign: 'right',
        formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>`,
      },
      {
        title: 'Taker Ratio',
        field: 'taker_buy_ratio',
        hozAlign: 'right',
        formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toFixed(4)}</span>`,
      },
      {
        title: 'Range (bps)',
        field: 'mean_hl_range',
        hozAlign: 'right',
        formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toFixed(1)}</span>`,
      },
      {
        title: 'Observations (n)',
        field: 'n',
        hozAlign: 'right',
        formatter: (c) => `<span class="font-mono text-muted">${Number(c.getValue()).toLocaleString('en-US')}</span>`,
      },
      {
        title: 'Instances',
        field: 'instances_view',
        hozAlign: 'center',
        width: 110,
        formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Drill Down &rarr;</button>`,
      },
    ];

    activeTable = createValidationTable(mountEl, {
      data: tableData,
      columns,
      pagination: false,
      exportFilename: `seasonality-${seasonalityBucket}-validation`,
      sheetName: `Seasonality_${seasonalityBucket}`,
      onRowClick: (row) => {
        const def = getMetricDef('seasonality.mean_return')!;
        const subset = selectInstances(rows, {
          domain: 'seasonality',
          bucketType: seasonalityBucket,
          bucketValue: row.bucket,
        });

        openInspectDrawer({
          defId: def.id,
          data: subset,
          meta: ctx.meta,
          qualityData: ctx.qualityData,
          currentTab: 'validation',
          bucket: seasonalityBucket,
          target: String(row.bucket),
        });
      },
    });
  }

  function renderUpcomingDomainPlaceholder(domain: ValidationDomain) {
    const d = DOMAINS.find((item) => item.id === domain)!;
    mountEl.innerHTML = `
      <div style="padding: 48px; text-align: center; color: var(--text-muted);">
        <h4 style="font-size: var(--text-lg); margin-bottom: 8px; color: var(--text-primary);">${d.label} Validation Tables</h4>
        <p style="max-width: 500px; margin: 0 auto 16px; font-size: var(--text-sm); line-height: 1.5;">${d.desc}</p>
        <span class="badge badge-info font-mono">Phase V2 Scope</span>
      </div>
    `;
  }

  // Domain switcher clicks
  container.querySelectorAll<HTMLButtonElement>('.btn-domain-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.domain as ValidationDomain;
      if (d && d !== currentDomain) {
        currentDomain = d;
        renderCurrentDomain();
      }
    });
  });

  // Initial render
  renderCurrentDomain();

  return {
    destroy() {
      if (activeTable) {
        activeTable.destroy();
        activeTable = null;
      }
    },
    setDomain(domain: ValidationDomain) {
      if (domain !== currentDomain) {
        currentDomain = domain;
        renderCurrentDomain();
      }
    },
  };
}
