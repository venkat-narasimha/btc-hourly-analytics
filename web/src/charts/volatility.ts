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
import { renderInfoTooltip, renderInspectTrigger } from '../ui/tooltip';

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
      <div class="card chart-card" style="display: flex; flex-direction: column;">
        <div class="hd chart-card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <h3 class="chart-card-title" style="margin: 0; display: flex; align-items: center; gap: 6px;">
            <span>Rolling Volatility (σ of Hourly Log Returns)</span>
            ${renderInfoTooltip({
              defId: 'volatility.rolling_vol',
              title: 'Rolling Historical Volatility',
              description: 'Sample standard deviation of hourly log returns computed over an backward sliding window of W hours.',
              caveat: 'Backward-looking window creates visual lag. Sudden volatility spikes appear wider than true duration.',
              position: 'bottom',
            })}
            <span id="rolling-inspect-wrap">
              ${renderInspectTrigger('volatility.rolling_vol', { window: currentWindow, title: 'Inspect Rolling Volatility' })}
            </span>
          </h3>
          <div class="field" style="display: inline-flex; align-items: center; gap: 8px; margin-left: auto;">
            <label>Window</label>
            <input type="range" id="vol-window-slider" min="24" max="720" step="24" value="168" style="cursor: pointer; width: 140px; accent-color: var(--amber);" />
            <b id="window-val-label" class="mono" style="color: var(--blue);">168h (7d)</b>
            ${renderInfoTooltip({
              title: 'Sliding Window Parameter (W)',
              description: 'Configures sample duration between 24h (1 day) and 720h (30 days). Default 168h represents 1 trading week.',
              position: 'left',
            })}
          </div>
        </div>
        <div id="rolling-vol-chart" class="bd chart-card-body no-padding" style="width: 100%; height: 260px;"></div>
      </div>

      <!-- Return Distribution Section -->
      <div class="grid2" style="flex: 1; min-height: 280px;">
        <div class="card chart-card" style="display: flex; flex-direction: column;">
          <div class="hd chart-card-header">
            <h3 class="chart-card-title" style="margin: 0; display: flex; align-items: center; gap: 6px;">
              <span>Return Distribution</span>
              ${renderInfoTooltip({
                defId: 'volatility.histogram',
                title: 'Empirical Return Distribution',
                description: 'Histogram of discrete hourly log returns partitioned into 50 equal-width bins spanning the observed range.',
                caveat: 'Non-Gaussian Leptokurtosis: Crypto returns feature heavy tails; standard normal assumptions drastically underestimate risk.',
                position: 'bottom',
              })}
              ${renderInspectTrigger('volatility.histogram', { title: 'Inspect Distribution Histogram' })}
            </h3>
            <small class="chart-card-subtitle text-muted" style="margin-left: 6px;">50 equal-width bins, bps</small>
          </div>
          <div id="dist-chart" class="bd chart-card-body no-padding" style="width: 100%; height: 260px; min-height: 260px;"></div>
        </div>

        <div class="card chart-card" style="display: flex; flex-direction: column;">
          <div class="hd chart-card-header">
            <h3 class="chart-card-title" style="margin: 0; display: flex; align-items: center; gap: 6px;">
              <span>Moments &amp; Quantiles</span>
              ${renderInfoTooltip({
                defId: 'volatility.distribution_std',
                title: 'Higher-Order Statistical Moments & Quantiles',
                description: 'Descriptive metrics quantifying central location, dispersion, skewness, excess kurtosis, and empirical quantile loss cutoffs.',
                caveat: 'Kurtosis > 3 implies fat tails where extreme multi-sigma flash crashes or short squeezes happen much more frequently than normal theory predicts.',
                position: 'left',
              })}
              ${renderInspectTrigger('volatility.distribution_std', { title: 'Inspect Moments & Quantiles' })}
            </h3>
            <small class="chart-card-subtitle text-muted" style="margin-left: 6px;">Population g₁/g₂ · nearest-rank quantiles</small>
          </div>
          <div id="dist-stats-panel" class="bd chart-card-body" style="overflow-y: auto;">
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

    const lineColor = currentTheme === 'light' ? '#2563EB' : '#60A5FA';
    const areaStart = currentTheme === 'light' ? 'rgba(37, 99, 235, 0.20)' : 'rgba(96, 165, 250, 0.25)';

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
          itemStyle: { color: currentTheme === 'light' ? '#7C3AED' : '#A78BFA' },
        },
      ],
    }, true);

    statsPanelEl.innerHTML = `
      <div class="rows">
        <div class="r">
          <span class="k" style="display: inline-flex; align-items: center; gap: 4px;">
            <span>Mean</span>
            ${renderInspectTrigger('volatility.distribution_mean', { title: 'Inspect Mean Return' })}
          </span>
          <span class="v mono">${stats.meanBps.toFixed(2)} bps</span>
        </div>
        <div class="r">
          <span class="k" style="display: inline-flex; align-items: center; gap: 4px;">
            <span>Sample σ</span>
            ${renderInspectTrigger('volatility.distribution_std', { title: 'Inspect Sample Std Dev' })}
          </span>
          <span class="v mono">${stats.stdBps.toFixed(2)} bps</span>
        </div>
        <div class="r">
          <span class="k" style="display: inline-flex; align-items: center; gap: 4px;">
            <span>Skewness g₁</span>
            ${renderInspectTrigger('volatility.distribution_skewness', { title: 'Inspect Skewness' })}
          </span>
          <span class="v mono ${stats.skewness < 0 ? 'bad' : 'good'}">${stats.skewness.toFixed(4)}</span>
        </div>
        <div class="r">
          <span class="k" style="display: inline-flex; align-items: center; gap: 4px;">
            <span>Excess kurtosis g₂</span>
            ${renderInspectTrigger('volatility.distribution_kurtosis', { title: 'Inspect Kurtosis' })}
          </span>
          <span class="v mono blue">${stats.kurtosis.toFixed(2)}${stats.kurtosis > 0 ? ' · fat tails' : ''}</span>
        </div>
        <div class="r"><span class="k">p1</span><span class="v mono bad">${stats.quantiles.p1.toFixed(1)} bps</span></div>
        <div class="r"><span class="k">p5</span><span class="v mono bad">${stats.quantiles.p5.toFixed(1)} bps</span></div>
        <div class="r"><span class="k">p25</span><span class="v mono">${stats.quantiles.p25.toFixed(1)} bps</span></div>
        <div class="r"><span class="k">p50 (Median)</span><span class="v mono blue">${stats.quantiles.p50.toFixed(1)} bps</span></div>
        <div class="r"><span class="k">p75</span><span class="v mono">${stats.quantiles.p75.toFixed(1)} bps</span></div>
        <div class="r"><span class="k">p95</span><span class="v mono good">${stats.quantiles.p95.toFixed(1)} bps</span></div>
        <div class="r"><span class="k">p99</span><span class="v mono good">${stats.quantiles.p99.toFixed(1)} bps</span></div>
      </div>
    `;
  }

  const rollingInspectWrap = container.querySelector('#rolling-inspect-wrap') as HTMLElement;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  slider.addEventListener('input', () => {
    currentWindow = Number(slider.value);
    const days = Math.round(currentWindow / 24);
    windowLabel.textContent = `${currentWindow}h (${days}d)`;
    if (rollingInspectWrap) {
      rollingInspectWrap.innerHTML = renderInspectTrigger('volatility.rolling_vol', {
        window: currentWindow,
        title: 'Inspect Rolling Volatility',
      });
    }
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
