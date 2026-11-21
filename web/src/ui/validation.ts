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
      <div class="validation-domain-bar" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
        ${DOMAINS.map((d) => `
          <button type="button" class="btn btn-sm btn-domain-tab ${d.id === currentDomain ? 'btn-primary active' : 'btn-secondary'}" data-domain="${d.id}" title="${d.desc}">
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
      { title: 'Day of Week', field: 'dayLabel', width: 140, headerFilter: 'input' },
      { title: 'Hour (UTC)', field: 'hourLabel', width: 130, headerFilter: 'input' },
      {
        title: 'Value',
        field: 'formattedValue',
        hozAlign: 'right',
        formatter: (c) => `<span class="font-mono font-semibold">${c.getValue()}</span>`,
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
        width: 120,
        formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Drill Down &rarr;</button>`,
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
        { title: 'Statistic', field: 'stat', formatter: (c) => `<strong>${c.getValue()}</strong>` },
        { title: 'Value', field: 'value', hozAlign: 'right', formatter: (c) => `<span class="font-mono">${c.getValue()}</span>` },
        { title: 'Observations (n)', field: 'n', hozAlign: 'right', formatter: (c) => `<span class="font-mono text-muted">${Number(c.getValue()).toLocaleString()}</span>` },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 120,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">View Returns &rarr;</button>`,
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
        { title: 'Bin #', field: 'binIndex', width: 80, hozAlign: 'center' },
        { title: 'Return Range', field: 'rangeBps', formatter: (c) => `<span class="font-mono">${c.getValue()}</span>` },
        { title: 'Observations (n)', field: 'count', hozAlign: 'right', formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toLocaleString()}</span>` },
        { title: 'Share (%)', field: 'pct', hozAlign: 'right', formatter: (c) => `<span class="font-mono">${c.getValue()}</span>` },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 120,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Drill Down &rarr;</button>`,
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
        { title: 'Time (UTC)', field: 'timeUtc', width: 160, headerFilter: 'input' },
        { title: 'Window', field: 'window', width: 100, hozAlign: 'center', formatter: () => `${rollingWindow}h` },
        {
          title: 'Volatility (bps)',
          field: 'volBps',
          hozAlign: 'right',
          formatter: (c) => `<span class="font-mono font-semibold">${Number(c.getValue()).toFixed(2)}</span>`,
        },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 120,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Inspect &rarr;</button>`,
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
        { title: 'Hour (UTC)', field: 'hourLabel', formatter: (c) => `<strong class="font-mono">${c.getValue()}</strong>`, width: 140 },
        {
          title: 'Taker Buy Ratio',
          field: 'takerRatio',
          hozAlign: 'right',
          formatter: (c) => `<span class="font-mono font-semibold">${Number(c.getValue()).toFixed(4)}</span>`,
        },
        {
          title: 'Dominance',
          field: 'takerRatio',
          hozAlign: 'center',
          width: 140,
          formatter: (c) => {
            const v = Number(c.getValue());
            return v > 0.50
              ? '<span class="badge badge-positive">Buyer Dominant</span>'
              : '<span class="badge badge-warning">Seller Dominant</span>';
          },
        },
        { title: 'Observations (n)', field: 'n', hozAlign: 'right', formatter: (c) => `<span class="font-mono text-muted">${Number(c.getValue()).toLocaleString()}</span>` },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 120,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Drill Down &rarr;</button>`,
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
        { title: 'Time (UTC)', field: 'timeUtc', width: 160, headerFilter: 'input' },
        {
          title: 'Bar Delta (BTC)',
          field: 'barDelta',
          hozAlign: 'right',
          formatter: (c) => {
            const v = Number(c.getValue());
            const cls = v >= 0 ? 'text-positive' : 'text-negative';
            return `<span class="${cls} font-mono">${v >= 0 ? '+' : ''}${v.toFixed(2)}</span>`;
          },
        },
        {
          title: 'Cumulative Delta (BTC)',
          field: 'cumDelta',
          hozAlign: 'right',
          formatter: (c) => `<span class="font-mono font-semibold">${Number(c.getValue()).toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>`,
        },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 120,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Inspect &rarr;</button>`,
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
        { title: 'Year', field: 'year', width: 90, hozAlign: 'center', headerFilter: 'input' },
        { title: 'Month', field: 'monthName', width: 120 },
        { title: 'First Open', field: 'startPrice', hozAlign: 'right', formatter: (c) => `$${Number(c.getValue()).toFixed(1)}` },
        { title: 'Last Close', field: 'endPrice', hozAlign: 'right', formatter: (c) => `$${Number(c.getValue()).toFixed(1)}` },
        {
          title: 'Return (%)',
          field: 'returnPct',
          hozAlign: 'right',
          formatter: (c) => {
            const v = Number(c.getValue());
            const cls = v >= 0 ? 'text-positive' : 'text-negative';
            return `<span class="${cls} font-mono font-semibold">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
          },
        },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 120,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Drill Down &rarr;</button>`,
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
        { title: 'Year', field: 'year', width: 100, hozAlign: 'center', formatter: (c) => `<strong class="font-mono">${c.getValue()}</strong>` },
        { title: 'Year Open', field: 'firstOpen', hozAlign: 'right', formatter: (c) => `$${Number(c.getValue()).toFixed(1)}` },
        { title: 'Year Close', field: 'lastClose', hozAlign: 'right', formatter: (c) => `$${Number(c.getValue()).toFixed(1)}` },
        {
          title: 'Compounded YTD Return (%)',
          field: 'ytdPct',
          hozAlign: 'right',
          formatter: (c) => {
            const v = Number(c.getValue());
            const cls = v >= 0 ? 'text-positive' : 'text-negative';
            return `<span class="${cls} font-mono font-semibold">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
          },
        },
        { title: 'Months', field: 'monthCount', hozAlign: 'center', width: 90 },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 120,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Drill Down &rarr;</button>`,
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
        { title: 'Time (UTC)', field: 'timeUtc', width: 160, headerFilter: 'input' },
        { title: 'Close Price', field: 'close', hozAlign: 'right', formatter: (c) => `$${Number(c.getValue()).toFixed(1)}` },
        { title: 'High-Water Mark', field: 'peak', hozAlign: 'right', formatter: (c) => `$${Number(c.getValue()).toFixed(1)}` },
        {
          title: 'Drawdown (%)',
          field: 'drawdownPct',
          hozAlign: 'right',
          formatter: (c) => {
            const v = Number(c.getValue());
            return `<span class="text-negative font-mono">${v.toFixed(2)}%</span>`;
          },
        },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 120,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Inspect &rarr;</button>`,
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
        { title: 'Gap #', field: 'index', width: 80, hozAlign: 'center' },
        { title: 'Outage Start (UTC)', field: 'startUtc', formatter: (c) => `<span class="font-mono">${c.getValue()}</span>` },
        { title: 'Outage End (UTC)', field: 'endUtc', formatter: (c) => `<span class="font-mono">${c.getValue()}</span>` },
        { title: 'Missing Hours', field: 'hours', hozAlign: 'right', formatter: (c) => `<span class="font-mono text-warning font-semibold">${c.getValue()}h</span>` },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 130,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">Inspect Bounding &rarr;</button>`,
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
        { title: 'Year', field: 'year', width: 100, hozAlign: 'center', formatter: (c) => `<strong class="font-mono">${c.getValue()}</strong>` },
        { title: 'Loaded Bars (n)', field: 'rows', hozAlign: 'right', formatter: (c) => `<span class="font-mono">${Number(c.getValue()).toLocaleString()}</span>` },
        { title: 'Expected Hours', field: 'expected', hozAlign: 'right', formatter: (c) => `<span class="font-mono text-muted">${Number(c.getValue()).toLocaleString()}</span>` },
        { title: 'Coverage (%)', field: 'covPct', hozAlign: 'right', formatter: (c) => `<span class="font-mono font-semibold">${c.getValue()}</span>` },
        {
          title: 'Audit Status',
          field: 'status',
          hozAlign: 'center',
          formatter: (c) => `<span class="badge ${String(c.getValue()).includes('Grade') ? 'badge-positive' : 'badge-warning'}">${c.getValue()}</span>`,
        },
        {
          title: 'Instances',
          field: 'instances_view',
          hozAlign: 'center',
          width: 120,
          formatter: () => `<button type="button" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px;">View Bars &rarr;</button>`,
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
        { title: 'Provenance Property', field: 'property', width: 260, formatter: (c) => `<strong>${c.getValue()}</strong>` },
        { title: 'Verified Release Value', field: 'value', formatter: (c) => `<span class="font-mono">${escapeHtml(String(c.getValue()))}</span>` },
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
