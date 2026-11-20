/**
 * Volatility & Distribution component.
 * Features:
 * - Rolling Volatility line chart (configurable window size, default 168h = 1 week)
 * - Hourly Return Distribution histogram
 * - Distribution metrics table: Mean, Std Dev, Skewness, Kurtosis, Quantiles
 * - Supports dynamic light and dark theme switching
 */

import * as echarts from 'echarts';
import type { KlineRow, Theme } from '../types';
import {
  computeDistributionStats,
  computeRollingVolatility,
} from '../stats/analytics';
import { getChartTheme } from '../ui/theme';
import { renderInfoTooltip } from '../ui/tooltip';

export interface VolatilityViewInstance {
  updateData(data: KlineRow[]): void;
  setTheme(theme: Theme): void;
  destroy(): void;
}

export function createVolatilityView(
  container: HTMLElement,
  initialData: KlineRow[],
  initialTheme: Theme = 'light'
): VolatilityViewInstance {
  let currentData = initialData;
  let currentWindow = 168; // default 1 week
  let currentTheme: Theme = initialTheme;

  container.innerHTML = `
    <div class="page-wrapper tab-enter volatility-view" style="display: flex; flex-direction: column; gap: 16px; height: 100%;">
      <!-- Rolling Volatility Section -->
      <div class="chart-card" style="display: flex; flex-direction: column;">
        <div class="chart-card-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h3 class="chart-card-title" style="margin: 0;">
            Rolling Volatility (σ of Hourly Log Returns)
            ${renderInfoTooltip({
              title: 'Rolling Historical Volatility',
              description: 'Sample standard deviation of hourly log returns computed over an backward sliding window of W hours.',
              formula: 'σ_t = √[ Σ(r_i − r̄)² / (W − 1) ] × 10,000 bps',
              caveat: 'Backward-looking window creates visual lag. Sudden volatility spikes appear wider than true duration.',
              position: 'bottom',
            })}
          </h3>
          <div style="display: flex; align-items: center; gap: 10px; font-size: var(--text-sm); color: var(--text-secondary);">
            <span>Window: <strong id="window-val-label" class="text-info" style="color: var(--color-info);">168h (7d)</strong></span>
            <input type="range" id="vol-window-slider" min="24" max="720" step="24" value="168" style="cursor: pointer; width: 140px; accent-color: var(--accent);" />
            ${renderInfoTooltip({
              title: 'Sliding Window Parameter (W)',
              description: 'Configures sample duration between 24h (1 day) and 720h (30 days). Default 168h represents 1 trading week.',
              position: 'left',
            })}
          </div>
        </div>
        <div id="rolling-vol-chart" class="chart-card-body no-padding" style="width: 100%; height: 260px;"></div>
      </div>

      <!-- Return Distribution Section -->
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 16px; flex: 1; min-height: 280px;">
        <div class="chart-card" style="display: flex; flex-direction: column;">
          <div class="chart-card-header">
            <h3 class="chart-card-title" style="margin: 0;">
              Return Distribution (Hourly Log Returns in Basis Points)
              ${renderInfoTooltip({
                title: 'Empirical Return Distribution',
                description: 'Histogram of discrete hourly log returns partitioned into 50 equal-width bins spanning the observed range.',
                formula: 'r_t = ln(Close_t / Close_t-1) × 10,000 bps',
                caveat: 'Non-Gaussian Leptokurtosis: Crypto returns feature heavy tails; standard normal assumptions drastically underestimate risk.',
                position: 'bottom',
              })}
            </h3>
          </div>
          <div id="dist-chart" class="chart-card-body no-padding" style="width: 100%; height: 260px; min-height: 260px;"></div>
        </div>

        <div class="chart-card" style="display: flex; flex-direction: column;">
          <div class="chart-card-header">
            <h3 class="chart-card-title" style="margin: 0;">
              Distribution Moments & Risk
              ${renderInfoTooltip({
                title: 'Higher-Order Statistical Moments & Quantiles',
                description: 'Descriptive metrics quantifying central location, dispersion, skewness, excess kurtosis, and empirical quantile loss cutoffs.',
                formula: 'Skewness = m₃ / s³,   Excess Kurtosis = (m₄ / s⁴) − 3',
                caveat: 'Kurtosis > 3 implies fat tails where extreme multi-sigma flash crashes or short squeezes happen much more frequently than normal theory predicts.',
                position: 'left',
              })}
            </h3>
          </div>
          <div id="dist-stats-panel" class="chart-card-body" style="font-size: var(--text-sm); display: flex; flex-direction: column; gap: 4px; overflow-y: auto;">
            <!-- Filled dynamically -->
          </div>
        </div>
      </div>
    </div>
  `;

  const volChartEl = container.querySelector('#rolling-vol-chart') as HTMLElement;
  const distChartEl = container.querySelector('#dist-chart') as HTMLElement;
  const statsPanelEl = container.querySelector('#dist-stats-panel') as HTMLElement;
  const slider = container.querySelector('#vol-window-slider') as HTMLInputElement;
  const windowLabel = container.querySelector('#window-val-label') as HTMLElement;

  const volChart = echarts.init(volChartEl);
  const distChart = echarts.init(distChartEl);

  function renderRollingVol() {
    const colors = getChartTheme(currentTheme);
    const points = computeRollingVolatility(currentData, currentWindow);
    const times = points.map(p => new Date(p.timeMs).toISOString().substring(0, 10));
    const vals = points.map(p => Number(p.volBps.toFixed(1)));

    const lineColor = currentTheme === 'light' ? '#2563eb' : '#38bdf8';
    const areaStart = currentTheme === 'light' ? 'rgba(37, 99, 235, 0.20)' : 'rgba(56, 189, 248, 0.25)';

    volChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        formatter: (params: any) => {
          const item = params[0];
          const pt = points[item.dataIndex];
          const d = new Date(pt.timeMs);
          const dtStr = `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;
          return `
            <div>${dtStr}</div>
            <div>Rolling Volatility: <strong>${item.value} bps</strong></div>
          `;
        },
      },
      grid: { left: 68, right: 20, top: 20, bottom: 25 },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: 'bps',
        nameTextStyle: { color: colors.textSecondary },
        splitLine: { lineStyle: { color: colors.gridLineColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'line',
          data: vals,
          showSymbol: false,
          lineStyle: { color: lineColor, width: 1.5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: areaStart },
              { offset: 1, color: 'rgba(56, 189, 248, 0.0)' },
            ]),
          },
        },
      ],
    }, true);
  }

  function renderDistribution() {
    const colors = getChartTheme(currentTheme);
    const stats = computeDistributionStats(currentData, 50);
    if (!stats) {
      statsPanelEl.innerHTML = '<div style="color: var(--text-muted);">Not enough data points</div>';
      return;
    }

    const bins = stats.histogram;
    const xLabels = bins.map(b => `${b.binStart.toFixed(0)}`);
    const counts = bins.map(b => b.count);

    distChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        formatter: (params: any) => {
          const idx = params[0].dataIndex;
          const b = bins[idx];
          return `
            <div>Range: [${b.binStart.toFixed(1)}, ${b.binEnd.toFixed(1)}] bps</div>
            <div>Frequency: <strong>${b.count.toLocaleString()} bars</strong></div>
          `;
        },
      },
      grid: { left: 50, right: 20, top: 20, bottom: 25 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 10, interval: 4 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: colors.gridLineColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 10 },
      },
      series: [
        {
          type: 'bar',
          data: counts,
          itemStyle: { color: '#6366f1' },
        },
      ],
    }, true);

    statsPanelEl.innerHTML = `
      <div class="insight-row" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);">
        <span style="color: var(--text-secondary);">Mean Return</span>
        <strong style="color: var(--text-primary); font-family: var(--font-mono, monospace);">${stats.meanBps.toFixed(2)} bps</strong>
      </div>
      <div class="insight-row" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);">
        <span style="color: var(--text-secondary);">Std Dev (σ)</span>
        <strong style="color: var(--text-primary); font-family: var(--font-mono, monospace);">${stats.stdBps.toFixed(2)} bps</strong>
      </div>
      <div class="insight-row" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);">
        <span style="color: var(--text-secondary);">Skewness</span>
        <strong style="color: ${stats.skewness >= 0 ? 'var(--color-positive)' : 'var(--color-warning)'}; font-family: var(--font-mono, monospace);">${stats.skewness.toFixed(3)}</strong>
      </div>
      <div class="insight-row" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);">
        <span style="color: var(--text-secondary);">Excess Kurtosis</span>
        <strong style="color: var(--color-info); font-family: var(--font-mono, monospace);">${stats.kurtosis.toFixed(2)}${stats.kurtosis > 0 ? ' (Fat tails)' : ''}</strong>
      </div>
      <div style="margin-top: 8px; font-size: var(--text-xs); color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Quantiles (bps)</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: var(--text-xs);">
        <div style="display: flex; justify-content: space-between;"><span>p1:</span> <strong style="color:var(--color-negative)">${stats.quantiles.p1.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p99:</span> <strong style="color:var(--color-positive)">${stats.quantiles.p99.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p5:</span> <strong style="color:var(--color-negative)">${stats.quantiles.p5.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p95:</span> <strong style="color:var(--color-positive)">${stats.quantiles.p95.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p25:</span> <strong>${stats.quantiles.p25.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p75:</span> <strong>${stats.quantiles.p75.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between; grid-column: span 2; border-top: 1px solid var(--border-subtle); padding-top: 4px;">
          <span>Median (p50):</span> <strong style="color: var(--color-info)">${stats.quantiles.p50.toFixed(1)} bps</strong>
        </div>
      </div>
    `;
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  slider.addEventListener('input', () => {
    currentWindow = Number(slider.value);
    const days = Math.round(currentWindow / 24);
    windowLabel.textContent = `${currentWindow}h (${days}d)`;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderRollingVol();
    }, 150);
  });

  const ro = new ResizeObserver(() => {
    volChart.resize();
    distChart.resize();
  });
  ro.observe(container);

  renderRollingVol();
  renderDistribution();

  return {
    updateData(data: KlineRow[]) {
      currentData = data;
      renderRollingVol();
      renderDistribution();
    },
    setTheme(th: Theme) {
      currentTheme = th;
      renderRollingVol();
      renderDistribution();
    },
    destroy() {
      ro.disconnect();
      volChart.dispose();
      distChart.dispose();
    },
  };
}
