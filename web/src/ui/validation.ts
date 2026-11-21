/**
 * Validation Section View (Complete - Phase V2).
 * "Enumerable-Instance Validation Tables"
 *
 * Exposes every KPI, cyclical matrix, distribution moment, and series
 * as interactive Tabulator tables with exact instance drill-downs,
 * live plain-language recompute proofs, and CSV/Excel exports.
 */

import type { KlineRow, Meta, QualityReport, SeasonalityMetric, ValidationDomain } from '../types';
import { getAllMetricDefs, getMetricDef } from '../verify/registry';
import { computeSeasonality, DOW_LABELS } from '../stats/aggregations';
import {
  computeHeatmap,
  computeDistributionStats,
  computeRollingVolatility,
  computeCumulativeTakerDelta,
  computeMonthlyReturns,
  computeDrawdownSeries,
} from '../stats/analytics';
import { formatVolumeAbbreviated } from '../stats/display';
import { createValidationTable, type ValidationTableInstance } from '../validation/table';
import { selectInstances } from '../validation/instances';
import { openInspectDrawer } from '../verify/drawer';
import type { ColumnDefinition } from 'tabulator-tables';

export interface ValidationViewContext {
  data: KlineRow[];
  meta: Meta | null;
  qualityData: QualityReport | null;
  startMs?: number;
  endMs?: number;
  initialDomain?: ValidationDomain;
}

type SeasonalityBucket = 'hour' | 'dow';

const DOMAINS: Array<{ id: ValidationDomain; label: string; desc: string }> = [
  { id: 'kpis', label: 'KPIs', desc: 'Summary scalar indicators and macro metrics' },
  { id: 'seasonality', label: 'Seasonality', desc: 'Wide table across all 6 metrics by Hour & Day-of-Week' },
  { id: 'heatmap', label: 'Heatmap', desc: '7×24 day-hour matrix (168 cells) with metric selector' },
  { id: 'volatility', label: 'Volatility', desc: 'Distribution moments, 50-bin histogram, and rolling vol series' },
  { id: 'flow', label: 'Flow', desc: 'Hourly taker flow and cumulative taker delta (CVD) series' },
  { id: 'calendar', label: 'Calendar', desc: 'Monthly returns grid, YTD returns, and drawdown series' },
  { id: 'raw', label: 'Raw Data', desc: 'All 60k raw 1h OHLCV bars across all 15 parquet columns' },
  { id: 'quality', label: 'Quality', desc: 'Exchange gaps, annual counts, and release provenance' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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

  // Domain sub-view state
  let seasonalityBucket: SeasonalityBucket = 'hour';
  let heatmapMetric: SeasonalityMetric = 'mean_return';
  let volatilitySubView: 'stats' | 'histogram' | 'series' = 'stats';
  const rollingWindow = 168;
  let flowSubView: 'hourly' | 'cvd' = 'hourly';
  let calendarSubView: 'monthly' | 'ytd' | 'drawdown' = 'monthly';
  let qualitySubView: 'gaps' | 'annual' | 'provenance' = 'gaps';

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
      <div class="validation-domain-bar seg" style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 16px; padding: 4px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface2);">
        ${DOMAINS.map((d) => `
          <button type="button" class="btn btn-sm btn-domain-tab ${d.id === currentDomain ? 'btn-primary active on' : 'btn-secondary'}" data-domain="${d.id}" title="${d.desc}">
            ${d.label}
          </button>
        `).join('')}
      </div>

      <!-- Domain Description Banner -->
      <div class="validation-domain-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
        <div>
          <h3 class="validation-domain-title" id="validation-domain-title" style="margin: 0; font-size: var(--text-md); font-weight: 600;"></h3>
          <p class="validation-domain-desc" id="validation-domain-desc" style="margin: 2px 0 0; font-size: var(--text-xs); color: var(--text-muted);"></p>
        </div>
        <div id="validation-domain-controls" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;"></div>
      </div>

      <!-- Table Container -->
      <div id="validation-table-mount" class="card" style="padding: 14px; min-height: 400px;"></div>
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
      btn.className = `btn btn-sm btn-domain-tab ${isCurrent ? 'btn-primary active on' : 'btn-secondary'}`;
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
      case 'heatmap':
        renderHeatmapDomain(rows, ctx);
        break;
      case 'volatility':
        renderVolatilityDomain(rows, ctx);
        break;
      case 'flow':
        renderFlowDomain(rows, ctx);
        break;
      case 'calendar':
        renderCalendarDomain(rows, ctx);
        break;
      case 'quality':
        renderQualityDomain(rows, ctx);
        break;
    }
  }

  // 1. Raw Data Domain: All 60k rows with 15 parquet columns
  function renderRawDataDomain(rows: KlineRow[], ctx: ValidationViewContext) {
    const columns: ColumnDefinition[] = [
      {
        title: 'Open Time (UTC)',
        field: 'open_time_ms',
        frozen: true,
        responsive: 0,
        formatter: (cell) => `<span class="font-mono text-xs">${formatUtc(cell.getValue())}</span>`,
        headerFilter: 'input',
        minWidth: 150,
      },
      {
        title: 'Open',
        field: 'open',
        hozAlign: 'right',
        responsive: 0,
        minWidth: 90,
        formatter: (c) => `<span class="font-tabular">${Number(c.getValue()).toFixed(1)}</span>`,
      },
      {
        title: 'High',
        field: 'high',
        hozAlign: 'right',
        responsive: 1,
        minWidth: 90,
        formatter: (c) => `<span class="font-tabular">${Number(c.getValue()).toFixed(1)}</span>`,
      },
      {
        title: 'Low',
        field: 'low',
        hozAlign: 'right',
        responsive: 1,
        minWidth: 90,
        formatter: (c) => `<span class="font-tabular">${Number(c.getValue()).toFixed(1)}</span>`,
      },
      {
        title: 'Close',
        field: 'close',
        hozAlign: 'right',
        responsive: 0,
        minWidth: 90,
        formatter: (c) => `<span class="font-tabular">${Number(c.getValue()).toFixed(1)}</span>`,
      },
      {
        title: 'Volume (BTC)',
        field: 'volume',
        hozAlign: 'right',
        responsive: 1,
        minWidth: 110,
        formatter: (c) => {
          const v = Number(c.getValue());
          const full = v.toLocaleString('en-US', { maximumFractionDigits: 2 });
          const abbr = formatVolumeAbbreviated(v);
          return `<span class="font-tabular" title="${full} BTC">${abbr}</span>`;
        },
      },
      {
        title: 'Quote Vol',
        field: 'quote_volume',
        hozAlign: 'right',
        responsive: 2,
        minWidth: 115,
        formatter: (c) => {
          const v = Number(c.getValue());
          const full = '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
          const abbr = '$' + formatVolumeAbbreviated(v);
          return `<span class="font-tabular" title="${full}">${abbr}</span>`;
        },
      },
      {
        title: 'Trades',
        field: 'trades',
        hozAlign: 'right',
        responsive: 2,
        minWidth: 85,
        formatter: (c) => `<span class="font-tabular">${Number(c.getValue()).toLocaleString()}</span>`,
      },
      {
        title: 'Taker Vol (BTC)',
        field: 'taker_buy_volume',
        hozAlign: 'right',
        responsive: 2,
        minWidth: 115,
        formatter: (c) => {
          const v = Number(c.getValue());
          const full = v.toLocaleString('en-US', { maximumFractionDigits: 2 });
          const abbr = formatVolumeAbbreviated(v);
          return `<span class="font-tabular" title="${full} BTC">${abbr}</span>`;
        },
      },
      {
        title: 'Taker Quote Vol',
        field: 'taker_buy_quote_volume',
        hozAlign: 'right',
        responsive: 3,
        minWidth: 120,
        formatter: (c) => {
          const v = Number(c.getValue());
          const full = '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
          const abbr = '$' + formatVolumeAbbreviated(v);
          return `<span class="font-tabular" title="${full}">${abbr}</span>`;
        },
      },
      {
        title: 'Log Ret (bps)',
        field: 'log_ret',
        hozAlign: 'right',
        responsive: 1,
        minWidth: 100,
        formatter: (c) => {
          const v = c.getValue();
          if (v === null || v === undefined) return '<span class="text-muted">—</span>';
          const bps = Number(v) * 10000;
          const cls = bps >= 0 ? 'text-positive' : 'text-negative';
          return `<span class="${cls} font-mono">${bps.toFixed(2)}</span>`;
        },
      },
      { title: 'Hour', field: 'hour', hozAlign: 'center', minWidth: 65, responsive: 2 },
      {
        title: 'DOW',
        field: 'dow',
        hozAlign: 'center',
        minWidth: 70,
        responsive: 2,
        formatter: (c) => DOW_LABELS[c.getValue()] || String(c.getValue()),
      },
      {
        title: 'Taker Ratio',
        field: 'taker_buy_ratio',
        hozAlign: 'right',
        responsive: 2,
        minWidth: 95,
        formatter: (c) => (c.getValue() !== null ? `<span class="font-tabular">${Number(c.getValue()).toFixed(4)}</span>` : '—'),
      },
      {
        title: 'H-L Range (bps)',
        field: 'hl_range',
        hozAlign: 'right',
        responsive: 2,
        minWidth: 105,
        formatter: (c) => `<span class="font-mono">${(Number(c.getValue()) * 10000).toFixed(1)}</span>`,
      },
      {
        title: 'Verify',
        field: 'instances_view',
        hozAlign: 'center',
        responsive: 0,
        minWidth: 90,
        formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
      },
    ];

    activeTable = createValidationTable(mountEl, {
      data: rows,
      columns,
      layout: 'fitDataFill',
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
        frozen: true,
        responsive: 0,
        formatter: (c) => `<strong style="color: var(--text-primary);">${c.getValue()}</strong>`,
        minWidth: 160,
      },
      {
        title: 'Value',
        field: 'value',
        hozAlign: 'right',
        responsive: 0,
        minWidth: 100,
        formatter: (c) => `<span class="font-tabular font-semibold" style="font-size: 13.5px;">${c.getValue()}</span>`,
      },
      { title: 'Unit', field: 'unit', hozAlign: 'center', minWidth: 80, responsive: 1 },
      {
        title: 'Observations (n)',
        field: 'n',
        hozAlign: 'right',
        responsive: 1,
        minWidth: 130,
        formatter: (c) => `<span class="font-tabular text-muted">${Number(c.getValue()).toLocaleString('en-US')}</span>`,
      },
      {
        title: 'Verify',
        field: 'instances_view',
        hozAlign: 'center',
        responsive: 0,
        minWidth: 90,
        formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
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
        frozen: true,
        responsive: 0,
        formatter: (c) => `<strong class="font-mono">${c.getValue()}</strong>`,
        minWidth: 120,
      },
      {
        title: 'Mean Ret (bps)',
        field: 'mean_return',
        hozAlign: 'right',
        responsive: 0,
        minWidth: 105,
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
        responsive: 1,
        minWidth: 105,
        formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toFixed(2)}</span>`,
      },
      {
        title: 'Win Rate (%)',
        field: 'win_rate',
        hozAlign: 'right',
        responsive: 1,
        minWidth: 95,
        formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toFixed(1)}%</span>`,
      },
      {
        title: 'Total Vol (BTC)',
        field: 'total_volume',
        hozAlign: 'right',
        responsive: 2,
        minWidth: 110,
        formatter: (c) => {
          const val = Number(c.getValue());
          const full = val.toLocaleString('en-US', { maximumFractionDigits: 1 });
          const abbr = formatVolumeAbbreviated(val);
          return `<span class="font-tabular" title="${full} BTC">${abbr}</span>`;
        },
      },
      {
        title: 'Taker Ratio',
        field: 'taker_buy_ratio',
        hozAlign: 'right',
        responsive: 2,
        minWidth: 95,
        formatter: (c) => `<span class="font-tabular">${Number(c.getValue()).toFixed(4)}</span>`,
      },
      {
        title: 'Range (bps)',
        field: 'mean_hl_range',
        hozAlign: 'right',
        responsive: 2,
        minWidth: 95,
        formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toFixed(1)}</span>`,
      },
      {
        title: 'Observations (n)',
        field: 'n',
        hozAlign: 'right',
        responsive: 1,
        minWidth: 130,
        formatter: (c) => `<span class="font-tabular text-muted">${Number(c.getValue()).toLocaleString('en-US')}</span>`,
      },
      {
        title: 'Verify',
        field: 'instances_view',
        hozAlign: 'center',
        responsive: 0,
        minWidth: 90,
        formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
      },
    ];

    activeTable = createValidationTable(mountEl, {
      data: tableData,
      columns,
      layout: 'fitDataFill',
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

  // 4. Heatmap Domain: 168 cells with metric selector
  function renderHeatmapDomain(rows: KlineRow[], ctx: ValidationViewContext) {
    const metrics: Array<{ id: SeasonalityMetric; label: string }> = [
      { id: 'mean_return', label: 'Mean Return (bps)' },
      { id: 'volatility', label: 'Volatility (bps)' },
      { id: 'win_rate', label: 'Win Rate (%)' },
      { id: 'total_volume', label: 'Total Volume (BTC)' },
      { id: 'taker_buy_ratio', label: 'Taker Ratio' },
      { id: 'mean_hl_range', label: 'H-L Range (bps)' },
    ];

    controlsEl.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center;">
        <span style="font-size: var(--text-xs); color: var(--text-muted);">Metric:</span>
        <select class="form-select form-select-sm" id="select-heatmap-metric" style="background: var(--bg-surface-elevated); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: var(--text-xs);">
          ${metrics.map((m) => `<option value="${m.id}" ${m.id === heatmapMetric ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </div>
    `;

    controlsEl.querySelector<HTMLSelectElement>('#select-heatmap-metric')?.addEventListener('change', (e) => {
      heatmapMetric = (e.target as HTMLSelectElement).value as SeasonalityMetric;
      renderHeatmapDomain(rows, ctx);
    });

    const cells = computeHeatmap(rows, heatmapMetric);
    const def = getMetricDef(`heatmap.${heatmapMetric}`) || getMetricDef('heatmap.mean_return')!;

    const tableData = cells.map((c) => ({
      cellKey: `${c.dow}:${c.hour}`,
      dow: c.dow,
      hour: c.hour,
      dayLabel: DOW_LABELS[c.dow],
      hourLabel: `${String(c.hour).padStart(2, '0')}:00 UTC`,
      value: c.value,
      formattedValue: def.format ? def.format(c.value) : c.value.toFixed(2),
      n: c.n,
    }));

    const columns: ColumnDefinition[] = [
      { title: 'Day of Week', field: 'dayLabel', frozen: true, responsive: 0, minWidth: 120, headerFilter: 'input' },
      { title: 'Hour (UTC)', field: 'hourLabel', responsive: 0, minWidth: 110, headerFilter: 'input' },
      {
        title: 'Value',
        field: 'formattedValue',
        hozAlign: 'right',
        responsive: 0,
        minWidth: 100,
        formatter: (c) => {
          const row = c.getRow().getData();
          if (heatmapMetric === 'total_volume') {
            const full = Number(row.value).toLocaleString('en-US', { maximumFractionDigits: 1 });
            const abbr = formatVolumeAbbreviated(row.value);
            return `<span class="font-tabular font-semibold" title="${full} BTC">${abbr}</span>`;
          }
          return `<span class="font-tabular font-semibold">${c.getValue()}</span>`;
        },
      },
      {
        title: 'Observations (n)',
        field: 'n',
        hozAlign: 'right',
        responsive: 1,
        minWidth: 130,
        formatter: (c) => `<span class="font-tabular text-muted">${Number(c.getValue()).toLocaleString('en-US')}</span>`,
      },
      {
        title: 'Verify',
        field: 'instances_view',
        hozAlign: 'center',
        responsive: 0,
        minWidth: 90,
        formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
      },
    ];

    activeTable = createValidationTable(mountEl, {
      data: tableData,
      columns,
      exportFilename: `heatmap-${heatmapMetric}-cells`,
      sheetName: 'Heatmap',
      pageSize: 24,
      onRowClick: (row) => {
        const subset = selectInstances(rows, {
          domain: 'heatmap',
          cellKey: row.cellKey,
        });

        openInspectDrawer({
          defId: def.id,
          data: subset,
          meta: ctx.meta,
          qualityData: ctx.qualityData,
          currentTab: 'validation',
          metric: heatmapMetric,
          target: row.cellKey,
        });
      },
    });
  }

  // 5. Volatility Domain: Stats, Histogram, and Full Rolling Series
  function renderVolatilityDomain(rows: KlineRow[], ctx: ValidationViewContext) {
    controlsEl.innerHTML = `
      <div style="display: flex; gap: 4px; background: var(--bg-surface-elevated); padding: 2px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <button type="button" class="btn btn-sm ${volatilitySubView === 'stats' ? 'btn-primary' : 'btn-ghost'}" id="btn-vol-stats">Distribution Stats</button>
        <button type="button" class="btn btn-sm ${volatilitySubView === 'histogram' ? 'btn-primary' : 'btn-ghost'}" id="btn-vol-hist">Histogram (50 bins)</button>
        <button type="button" class="btn btn-sm ${volatilitySubView === 'series' ? 'btn-primary' : 'btn-ghost'}" id="btn-vol-series">Rolling Vol Series</button>
      </div>
    `;

    controlsEl.querySelector('#btn-vol-stats')?.addEventListener('click', () => {
      volatilitySubView = 'stats';
      renderVolatilityDomain(rows, ctx);
    });
    controlsEl.querySelector('#btn-vol-hist')?.addEventListener('click', () => {
      volatilitySubView = 'histogram';
      renderVolatilityDomain(rows, ctx);
    });
    controlsEl.querySelector('#btn-vol-series')?.addEventListener('click', () => {
      volatilitySubView = 'series';
      renderVolatilityDomain(rows, ctx);
    });

    const dist = computeDistributionStats(rows, 50);
    const n = rows.filter((r) => r.log_ret !== null && r.log_ret !== undefined).length;

    if (volatilitySubView === 'stats') {
      const statsRows = dist
        ? [
            { stat: 'Mean Return (x̄)', value: `${dist.meanBps.toFixed(2)} bps`, defId: 'volatility.distribution_mean', n },
            { stat: 'Sample Std Dev (s)', value: `${dist.stdBps.toFixed(2)} bps`, defId: 'volatility.distribution_std', n },
            { stat: 'Skewness (g1)', value: dist.skewness.toFixed(4), defId: 'volatility.distribution_skewness', n },
            { stat: 'Excess Kurtosis (g2)', value: dist.kurtosis.toFixed(4), defId: 'volatility.distribution_kurtosis', n },
            { stat: 'p1 Percentile', value: `${dist.quantiles.p1.toFixed(2)} bps`, defId: 'volatility.quantiles', n },
            { stat: 'p5 Percentile', value: `${dist.quantiles.p5.toFixed(2)} bps`, defId: 'volatility.quantiles', n },
            { stat: 'p25 Percentile (Q1)', value: `${dist.quantiles.p25.toFixed(2)} bps`, defId: 'volatility.quantiles', n },
            { stat: 'p50 Percentile (Median)', value: `${dist.quantiles.p50.toFixed(2)} bps`, defId: 'volatility.quantiles', n },
            { stat: 'p75 Percentile (Q3)', value: `${dist.quantiles.p75.toFixed(2)} bps`, defId: 'volatility.quantiles', n },
            { stat: 'p95 Percentile', value: `${dist.quantiles.p95.toFixed(2)} bps`, defId: 'volatility.quantiles', n },
            { stat: 'p99 Percentile', value: `${dist.quantiles.p99.toFixed(2)} bps`, defId: 'volatility.quantiles', n },
          ]
        : [];

      const columns: ColumnDefinition[] = [
        { title: 'Statistic', field: 'stat', frozen: true, responsive: 0, minWidth: 160, formatter: (c) => `<strong>${c.getValue()}</strong>` },
        { title: 'Value', field: 'value', hozAlign: 'right', responsive: 0, minWidth: 100, formatter: (c) => `<span class="font-tabular font-semibold">${c.getValue()}</span>` },
        { title: 'Observations (n)', field: 'n', hozAlign: 'right', responsive: 1, minWidth: 130, formatter: (c) => `<span class="font-tabular text-muted">${Number(c.getValue()).toLocaleString()}</span>` },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: statsRows,
        columns,
        pagination: false,
        exportFilename: 'volatility-stats-validation',
        sheetName: 'VolStats',
        onRowClick: (row) => {
          openInspectDrawer({
            defId: row.defId,
            data: rows,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
          });
        },
      });
    } else if (volatilitySubView === 'histogram') {
      const hist = dist?.histogram || [];
      const totalCount = hist.reduce((sum, b) => sum + b.count, 0);
      const histRows = hist.map((b, idx) => ({
        binIndex: idx + 1,
        rangeBps: `${b.binStart.toFixed(1)} to ${b.binEnd.toFixed(1)} bps`,
        binMin: b.binStart,
        binMax: b.binEnd,
        isLastBin: idx === hist.length - 1,
        count: b.count,
        pct: totalCount > 0 ? ((b.count / totalCount) * 100).toFixed(2) + '%' : '0.00%',
      }));

      const columns: ColumnDefinition[] = [
        { title: 'Bin #', field: 'binIndex', frozen: true, responsive: 0, minWidth: 70, hozAlign: 'center' },
        { title: 'Return Range', field: 'rangeBps', responsive: 0, minWidth: 140, formatter: (c) => `<span class="font-tabular">${c.getValue()}</span>` },
        { title: 'Observations (n)', field: 'count', hozAlign: 'right', responsive: 1, minWidth: 130, formatter: (c) => `<span class="font-tabular">${Number(c.getValue()).toLocaleString()}</span>` },
        { title: 'Share (%)', field: 'pct', hozAlign: 'right', responsive: 1, minWidth: 90, formatter: (c) => `<span class="font-tabular">${c.getValue()}</span>` },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: histRows,
        columns,
        pageSize: 25,
        exportFilename: 'volatility-histogram-50bins',
        sheetName: 'Histogram',
        onRowClick: (row) => {
          const subset = selectInstances(rows, {
            domain: 'volatility',
            binRange: [row.binMin, row.binMax],
            isLastBin: Boolean(row.isLastBin),
          });
          openInspectDrawer({
            defId: 'volatility.histogram',
            data: subset,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
            target: String(row.binIndex),
          });
        },
      });
    } else {
      // Full rolling vol series (~60k rows)
      const rollingPoints = computeRollingVolatility(rows, rollingWindow);
      const seriesRows = rollingPoints.map((pt) => ({
        timeMs: pt.timeMs,
        timeUtc: formatUtc(pt.timeMs),
        volBps: pt.volBps,
        window: rollingWindow,
      }));

      const columns: ColumnDefinition[] = [
        { title: 'Time (UTC)', field: 'timeUtc', frozen: true, responsive: 0, minWidth: 150, headerFilter: 'input' },
        { title: 'Window', field: 'window', minWidth: 80, hozAlign: 'center', responsive: 1, formatter: () => `${rollingWindow}h` },
        {
          title: 'Volatility (bps)',
          field: 'volBps',
          hozAlign: 'right',
          responsive: 0,
          minWidth: 110,
          formatter: (c) => `<span class="font-tabular font-semibold">${Number(c.getValue()).toFixed(2)}</span>`,
        },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: seriesRows,
        columns,
        pageSize: 25,
        exportFilename: `rolling-volatility-${rollingWindow}h-series`,
        sheetName: 'RollingVol',
        onRowClick: (row) => {
          const subset = selectInstances(rows, {
            domain: 'volatility',
            openTimeMs: row.timeMs,
            window: rollingWindow,
          });
          openInspectDrawer({
            defId: 'volatility.rolling_vol',
            data: subset,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
            startMs: row.timeMs,
            window: rollingWindow,
          });
        },
      });
    }
  }

  // 6. Flow Domain: Hourly Taker Ratio and Full CVD Series
  function renderFlowDomain(rows: KlineRow[], ctx: ValidationViewContext) {
    controlsEl.innerHTML = `
      <div style="display: flex; gap: 4px; background: var(--bg-surface-elevated); padding: 2px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <button type="button" class="btn btn-sm ${flowSubView === 'hourly' ? 'btn-primary' : 'btn-ghost'}" id="btn-flow-hourly">Hourly Taker Ratio</button>
        <button type="button" class="btn btn-sm ${flowSubView === 'cvd' ? 'btn-primary' : 'btn-ghost'}" id="btn-flow-cvd">CVD Full Series</button>
      </div>
    `;

    controlsEl.querySelector('#btn-flow-hourly')?.addEventListener('click', () => {
      flowSubView = 'hourly';
      renderFlowDomain(rows, ctx);
    });
    controlsEl.querySelector('#btn-flow-cvd')?.addEventListener('click', () => {
      flowSubView = 'cvd';
      renderFlowDomain(rows, ctx);
    });

    if (flowSubView === 'hourly') {
      const takerRatios = computeSeasonality(rows, 'hour', 'taker_buy_ratio');
      const tableData = takerRatios.map((item) => ({
        hour: item.bucket,
        hourLabel: `${String(item.bucket).padStart(2, '0')}:00 UTC`,
        takerRatio: item.value,
        n: item.n,
      }));

      const columns: ColumnDefinition[] = [
        { title: 'Hour (UTC)', field: 'hourLabel', frozen: true, responsive: 0, minWidth: 120, formatter: (c) => `<strong class="font-mono">${c.getValue()}</strong>` },
        {
          title: 'Taker Buy Ratio',
          field: 'takerRatio',
          hozAlign: 'right',
          responsive: 0,
          minWidth: 100,
          formatter: (c) => `<span class="font-tabular font-semibold">${Number(c.getValue()).toFixed(4)}</span>`,
        },
        {
          title: 'Dominance',
          field: 'takerRatio',
          hozAlign: 'center',
          responsive: 1,
          minWidth: 130,
          formatter: (c) => {
            const v = Number(c.getValue());
            return v > 0.50
              ? '<span class="badge badge-positive">Buyer Dominant</span>'
              : '<span class="badge badge-warning">Seller Dominant</span>';
          },
        },
        { title: 'Observations (n)', field: 'n', hozAlign: 'right', responsive: 1, minWidth: 130, formatter: (c) => `<span class="font-tabular text-muted">${Number(c.getValue()).toLocaleString()}</span>` },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: tableData,
        columns,
        pagination: false,
        exportFilename: 'flow-hourly-taker-ratio',
        sheetName: 'HourlyTakerRatio',
        onRowClick: (row) => {
          const subset = selectInstances(rows, {
            domain: 'flow',
            bucketValue: row.hour,
          });
          openInspectDrawer({
            defId: 'flow.taker_buy_ratio',
            data: subset,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
            bucket: 'hour',
            target: String(row.hour),
          });
        },
      });
    } else {
      // CVD Full series (~60k rows)
      const cvdPoints = computeCumulativeTakerDelta(rows);
      const seriesRows = cvdPoints.map((pt) => ({
        timeMs: pt.timeMs,
        timeUtc: formatUtc(pt.timeMs),
        barDelta: pt.delta,
        cumDelta: pt.cumDelta,
      }));

      const columns: ColumnDefinition[] = [
        { title: 'Time (UTC)', field: 'timeUtc', frozen: true, responsive: 0, minWidth: 150, headerFilter: 'input' },
        {
          title: 'Bar Delta (BTC)',
          field: 'barDelta',
          hozAlign: 'right',
          responsive: 1,
          minWidth: 120,
          formatter: (c) => {
            const v = Number(c.getValue());
            const cls = v >= 0 ? 'text-positive' : 'text-negative';
            const full = (v >= 0 ? '+' : '') + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
            const abbr = (v >= 0 ? '+' : '') + formatVolumeAbbreviated(v);
            return `<span class="${cls} font-tabular" title="${full} BTC">${abbr}</span>`;
          },
        },
        {
          title: 'Cumulative Delta (BTC)',
          field: 'cumDelta',
          hozAlign: 'right',
          responsive: 0,
          minWidth: 130,
          formatter: (c) => {
            const v = Number(c.getValue());
            const full = v.toLocaleString('en-US', { maximumFractionDigits: 1 });
            const abbr = formatVolumeAbbreviated(v);
            return `<span class="font-tabular font-semibold" title="${full} BTC">${abbr}</span>`;
          },
        },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: seriesRows,
        columns,
        pageSize: 25,
        exportFilename: 'flow-cvd-full-series',
        sheetName: 'CVD',
        onRowClick: (row) => {
          const subset = selectInstances(rows, {
            domain: 'flow',
            openTimeMs: row.timeMs,
          });
          openInspectDrawer({
            defId: 'flow.cvd',
            data: subset,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
            startMs: row.timeMs,
          });
        },
      });
    }
  }

  // 7. Calendar Domain: Monthly Returns, YTD, and Drawdown Series
  function renderCalendarDomain(rows: KlineRow[], ctx: ValidationViewContext) {
    controlsEl.innerHTML = `
      <div style="display: flex; gap: 4px; background: var(--bg-surface-elevated); padding: 2px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <button type="button" class="btn btn-sm ${calendarSubView === 'monthly' ? 'btn-primary' : 'btn-ghost'}" id="btn-cal-monthly">Monthly Returns</button>
        <button type="button" class="btn btn-sm ${calendarSubView === 'ytd' ? 'btn-primary' : 'btn-ghost'}" id="btn-cal-ytd">Annual YTD</button>
        <button type="button" class="btn btn-sm ${calendarSubView === 'drawdown' ? 'btn-primary' : 'btn-ghost'}" id="btn-cal-dd">Drawdown Series</button>
      </div>
    `;

    controlsEl.querySelector('#btn-cal-monthly')?.addEventListener('click', () => {
      calendarSubView = 'monthly';
      renderCalendarDomain(rows, ctx);
    });
    controlsEl.querySelector('#btn-cal-ytd')?.addEventListener('click', () => {
      calendarSubView = 'ytd';
      renderCalendarDomain(rows, ctx);
    });
    controlsEl.querySelector('#btn-cal-dd')?.addEventListener('click', () => {
      calendarSubView = 'drawdown';
      renderCalendarDomain(rows, ctx);
    });

    if (calendarSubView === 'monthly') {
      const monthlyReturns = computeMonthlyReturns(rows);
      const tableData = monthlyReturns.map((m) => {
        const ym = `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
        return {
          yearMonth: ym,
          year: m.year,
          monthName: MONTH_NAMES[m.month],
          startPrice: m.startPrice,
          endPrice: m.endPrice,
          returnPct: m.returnPct,
        };
      });

      const columns: ColumnDefinition[] = [
        { title: 'Year', field: 'year', frozen: true, responsive: 0, minWidth: 80, hozAlign: 'center', headerFilter: 'input' },
        { title: 'Month', field: 'monthName', responsive: 0, minWidth: 110 },
        { title: 'First Open', field: 'startPrice', hozAlign: 'right', responsive: 1, minWidth: 100, formatter: (c) => `<span class="font-tabular">$${Number(c.getValue()).toFixed(1)}</span>` },
        { title: 'Last Close', field: 'endPrice', hozAlign: 'right', responsive: 1, minWidth: 100, formatter: (c) => `<span class="font-tabular">$${Number(c.getValue()).toFixed(1)}</span>` },
        {
          title: 'Return (%)',
          field: 'returnPct',
          hozAlign: 'right',
          responsive: 0,
          minWidth: 100,
          formatter: (c) => {
            const v = Number(c.getValue());
            const cls = v >= 0 ? 'text-positive' : 'text-negative';
            return `<span class="${cls} font-tabular font-semibold">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
          },
        },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: tableData,
        columns,
        pageSize: 20,
        exportFilename: 'calendar-monthly-returns',
        sheetName: 'MonthlyReturns',
        onRowClick: (row) => {
          const subset = selectInstances(rows, {
            domain: 'calendar',
            yearMonth: row.yearMonth,
          });
          openInspectDrawer({
            defId: 'calendar.monthly_returns',
            data: subset,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
            target: row.yearMonth,
          });
        },
      });
    } else if (calendarSubView === 'ytd') {
      const monthlyReturns = computeMonthlyReturns(rows);
      const byYear: Record<number, typeof monthlyReturns> = {};
      for (const m of monthlyReturns) {
        if (!byYear[m.year]) byYear[m.year] = [];
        byYear[m.year].push(m);
      }

      const ytdRows = Object.keys(byYear)
        .map(Number)
        .sort((a, b) => b - a)
        .map((yr) => {
          const months = byYear[yr];
          const firstOpen = months[0].startPrice;
          const lastClose = months[months.length - 1].endPrice;
          const ytdPct = ((lastClose - firstOpen) / firstOpen) * 100;

          return {
            year: yr,
            firstOpen,
            lastClose,
            ytdPct,
            monthCount: months.length,
          };
        });

      const columns: ColumnDefinition[] = [
        { title: 'Year', field: 'year', frozen: true, responsive: 0, minWidth: 80, hozAlign: 'center', formatter: (c) => `<strong class="font-mono">${c.getValue()}</strong>` },
        { title: 'Year Open', field: 'firstOpen', hozAlign: 'right', responsive: 1, minWidth: 100, formatter: (c) => `<span class="font-tabular">$${Number(c.getValue()).toFixed(1)}</span>` },
        { title: 'Year Close', field: 'lastClose', hozAlign: 'right', responsive: 1, minWidth: 100, formatter: (c) => `<span class="font-tabular">$${Number(c.getValue()).toFixed(1)}</span>` },
        {
          title: 'Compounded YTD Return (%)',
          field: 'ytdPct',
          hozAlign: 'right',
          responsive: 0,
          minWidth: 120,
          formatter: (c) => {
            const v = Number(c.getValue());
            const cls = v >= 0 ? 'text-positive' : 'text-negative';
            return `<span class="${cls} font-tabular font-semibold">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
          },
        },
        { title: 'Months', field: 'monthCount', hozAlign: 'center', responsive: 1, minWidth: 80 },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: ytdRows,
        columns,
        pagination: false,
        exportFilename: 'calendar-annual-ytd-returns',
        sheetName: 'AnnualYTD',
        onRowClick: (row) => {
          const subset = selectInstances(rows, {
            domain: 'calendar',
            year: row.year,
          });
          openInspectDrawer({
            defId: 'calendar.ytd',
            data: subset,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
            target: String(row.year),
          });
        },
      });
    } else {
      // Drawdown full series (~60k rows)
      const ddData = computeDrawdownSeries(rows);
      const seriesRows = ddData.series.map((pt) => ({
        timeMs: pt.timeMs,
        timeUtc: formatUtc(pt.timeMs),
        close: pt.close,
        peak: pt.peak,
        drawdownPct: pt.drawdownPct,
      }));

      const columns: ColumnDefinition[] = [
        { title: 'Time (UTC)', field: 'timeUtc', frozen: true, responsive: 0, minWidth: 150, headerFilter: 'input' },
        { title: 'Close Price', field: 'close', hozAlign: 'right', responsive: 0, minWidth: 100, formatter: (c) => `<span class="font-tabular">$${Number(c.getValue()).toFixed(1)}</span>` },
        { title: 'High-Water Mark', field: 'peak', hozAlign: 'right', responsive: 1, minWidth: 100, formatter: (c) => `<span class="font-tabular">$${Number(c.getValue()).toFixed(1)}</span>` },
        {
          title: 'Drawdown (%)',
          field: 'drawdownPct',
          hozAlign: 'right',
          responsive: 0,
          minWidth: 110,
          formatter: (c) => {
            const v = Number(c.getValue());
            return `<span class="text-negative font-tabular">${v.toFixed(2)}%</span>`;
          },
        },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: seriesRows,
        columns,
        pageSize: 25,
        exportFilename: 'historical-drawdown-series',
        sheetName: 'Drawdown',
        onRowClick: (row) => {
          const subset = selectInstances(rows, {
            domain: 'calendar',
            openTimeMs: row.timeMs,
          });
          openInspectDrawer({
            defId: 'calendar.drawdown_series',
            data: subset,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
            startMs: row.timeMs,
          });
        },
      });
    }
  }

  // 8. Quality Domain: Gaps, Annual Counts, Provenance
  function renderQualityDomain(rows: KlineRow[], ctx: ValidationViewContext) {
    controlsEl.innerHTML = `
      <div style="display: flex; gap: 4px; background: var(--bg-surface-elevated); padding: 2px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <button type="button" class="btn btn-sm ${qualitySubView === 'gaps' ? 'btn-primary' : 'btn-ghost'}" id="btn-qual-gaps">Exchange Gaps</button>
        <button type="button" class="btn btn-sm ${qualitySubView === 'annual' ? 'btn-primary' : 'btn-ghost'}" id="btn-qual-annual">Annual Observations</button>
        <button type="button" class="btn btn-sm ${qualitySubView === 'provenance' ? 'btn-primary' : 'btn-ghost'}" id="btn-qual-prov">Provenance Lineage</button>
      </div>
    `;

    controlsEl.querySelector('#btn-qual-gaps')?.addEventListener('click', () => {
      qualitySubView = 'gaps';
      renderQualityDomain(rows, ctx);
    });
    controlsEl.querySelector('#btn-qual-annual')?.addEventListener('click', () => {
      qualitySubView = 'annual';
      renderQualityDomain(rows, ctx);
    });
    controlsEl.querySelector('#btn-qual-prov')?.addEventListener('click', () => {
      qualitySubView = 'provenance';
      renderQualityDomain(rows, ctx);
    });

    const report = ctx.qualityData;

    if (qualitySubView === 'gaps') {
      const gaps = report?.missing_ranges || [];
      const gapsRows = gaps.map((g, idx) => ({
        index: idx + 1,
        startUtc: formatUtc(g.start_ms),
        endUtc: formatUtc(g.end_ms),
        startMs: g.start_ms,
        endMs: g.end_ms,
        hours: g.hours,
      }));

      const columns: ColumnDefinition[] = [
        { title: 'Gap #', field: 'index', frozen: true, responsive: 0, minWidth: 70, hozAlign: 'center' },
        { title: 'Outage Start (UTC)', field: 'startUtc', responsive: 0, minWidth: 150, formatter: (c) => `<span class="font-tabular">${c.getValue()}</span>` },
        { title: 'Outage End (UTC)', field: 'endUtc', responsive: 0, minWidth: 150, formatter: (c) => `<span class="font-tabular">${c.getValue()}</span>` },
        { title: 'Missing Hours', field: 'hours', hozAlign: 'right', responsive: 1, minWidth: 110, formatter: (c) => `<span class="font-tabular text-warning font-semibold">${c.getValue()}h</span>` },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: gapsRows,
        columns,
        pagination: false,
        exportFilename: 'quality-exchange-gaps',
        sheetName: 'Gaps',
        onRowClick: (row) => {
          const subset = selectInstances(rows, {
            domain: 'quality',
            gapStartMs: row.startMs,
            gapEndMs: row.endMs,
          });
          openInspectDrawer({
            defId: 'quality.gaps',
            data: subset,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
            startMs: row.startMs,
            endMs: row.endMs,
          });
        },
      });
    } else if (qualitySubView === 'annual') {
      const perYear = report?.per_year_row_counts || {};
      const annualRows = Object.keys(perYear)
        .map(Number)
        .sort((a, b) => b - a)
        .map((yr) => {
          const count = perYear[String(yr)];
          const isLeap = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
          const expected = yr === new Date().getUTCFullYear() ? count : isLeap ? 8784 : 8760;
          const covPct = Math.min(100, (count / expected) * 100);

          return {
            year: yr,
            rows: count,
            expected,
            covPct: covPct.toFixed(2) + '%',
            status: covPct >= 99 ? 'Institutional Grade' : 'Minor Gaps Present',
          };
        });

      const columns: ColumnDefinition[] = [
        { title: 'Year', field: 'year', frozen: true, responsive: 0, minWidth: 80, hozAlign: 'center', formatter: (c) => `<strong class="font-mono">${c.getValue()}</strong>` },
        { title: 'Loaded Bars (n)', field: 'rows', hozAlign: 'right', responsive: 0, minWidth: 130, formatter: (c) => `<span class="font-tabular">${Number(c.getValue()).toLocaleString()}</span>` },
        { title: 'Expected Hours', field: 'expected', hozAlign: 'right', responsive: 1, minWidth: 120, formatter: (c) => `<span class="font-tabular text-muted">${Number(c.getValue()).toLocaleString()}</span>` },
        { title: 'Coverage (%)', field: 'covPct', hozAlign: 'right', responsive: 0, minWidth: 100, formatter: (c) => `<span class="font-tabular font-semibold">${c.getValue()}</span>` },
        {
          title: 'Audit Status',
          field: 'status',
          hozAlign: 'center',
          responsive: 1,
          minWidth: 140,
          formatter: (c) => `<span class="badge ${String(c.getValue()).includes('Grade') ? 'badge-positive' : 'badge-warning'}">${c.getValue()}</span>`,
        },
        {
          title: 'Verify',
          field: 'instances_view',
          hozAlign: 'center',
          responsive: 0,
          minWidth: 90,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Verify &rarr;</button>`,
        },
      ];

      activeTable = createValidationTable(mountEl, {
        data: annualRows,
        columns,
        pagination: false,
        exportFilename: 'quality-annual-counts',
        sheetName: 'AnnualCounts',
        onRowClick: (row) => {
          const subset = selectInstances(rows, {
            domain: 'quality',
            year: row.year,
          });
          openInspectDrawer({
            defId: 'kpi.per_year_counts',
            data: subset,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
            target: String(row.year),
          });
        },
      });
    } else {
      // Provenance lineage
      const meta = ctx.meta;
      const provRows = [
        { property: 'Release Identifier', value: meta?.release_id || 'unknown' },
        { property: 'Pipeline Git SHA', value: meta?.pipeline_git_sha || 'unknown' },
        { property: 'Artifact SHA-256 Checksum', value: meta?.artifact_sha256 || 'Calculated during server-side export' },
        { property: 'Dataset Generation (UTC)', value: meta?.generated_at_utc || 'unknown' },
        { property: 'Source Archive Ingest', value: `${meta?.files_downloaded?.monthly ?? 0} monthly + ${meta?.files_downloaded?.daily ?? 0} daily ZIPs` },
        { property: 'Binance Source Base URL', value: meta?.source_base_url || 'https://data.binance.vision' },
        { property: 'Hourly Candlestick Total', value: `${rows.length.toLocaleString()} rows` },
      ];

      const columns: ColumnDefinition[] = [
        { title: 'Provenance Property', field: 'property', frozen: true, responsive: 0, minWidth: 220, formatter: (c) => `<strong>${c.getValue()}</strong>` },
        { title: 'Verified Release Value', field: 'value', responsive: 0, minWidth: 240, formatter: (c) => `<span class="font-tabular">${escapeHtml(String(c.getValue()))}</span>` },
      ];

      activeTable = createValidationTable(mountEl, {
        data: provRows,
        columns,
        pagination: false,
        exportFilename: 'quality-provenance-lineage',
        sheetName: 'Provenance',
        onRowClick: () => {
          openInspectDrawer({
            defId: 'quality.provenance',
            data: rows,
            meta: ctx.meta,
            qualityData: ctx.qualityData,
            currentTab: 'validation',
          });
        },
      });
    }
  }

  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
