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
    <div class="volatility-view" style="display: flex; flex-direction: column; gap: 16px; height: 100%;">
      <!-- Rolling Volatility Section -->
      <div class="chart-panel" style="padding: 14px; display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">
            Rolling Volatility (σ of Hourly Log Returns)
          </div>
          <div style="display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-secondary);">
            <span>Window: <strong id="window-val-label" style="color: var(--color-blue);">168h (7d)</strong></span>
            <input type="range" id="vol-window-slider" min="24" max="720" step="24" value="168" style="cursor: pointer; width: 140px;" />
          </div>
        </div>
        <div id="rolling-vol-chart" style="width: 100%; height: 260px;"></div>
      </div>

      <!-- Return Distribution Section -->
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 16px; flex: 1; min-height: 280px;">
        <div class="chart-panel" style="padding: 14px; display: flex; flex-direction: column;">
          <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">
            Return Distribution (Hourly Log Returns in Basis Points)
          </div>
          <div id="dist-chart" style="flex: 1; width: 100%; min-height: 220px;"></div>
        </div>

        <div class="chart-panel" style="padding: 14px; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">
            Distribution Moments & Risk
          </div>
          <div id="dist-stats-panel" style="font-size: 13px; display: flex; flex-direction: column; gap: 8px;">
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
          return `
            <div>${times[item.dataIndex]}</div>
            <div>Rolling Volatility: <strong>${item.value} bps</strong></div>
          `;
        },
      },
      grid: { left: 55, right: 20, top: 20, bottom: 25 },
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
      <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding: 4px 0;">
        <span style="color: var(--text-secondary);">Mean Return</span>
        <strong style="color: var(--text-primary); font-family: monospace;">${stats.meanBps.toFixed(2)} bps</strong>
      </div>
      <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding: 4px 0;">
        <span style="color: var(--text-secondary);">Std Dev (σ)</span>
        <strong style="color: var(--text-primary); font-family: monospace;">${stats.stdBps.toFixed(2)} bps</strong>
      </div>
      <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding: 4px 0;">
        <span style="color: var(--text-secondary);">Skewness</span>
        <strong style="color: ${stats.skewness >= 0 ? 'var(--color-green)' : 'var(--color-amber)'}; font-family: monospace;">${stats.skewness.toFixed(3)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding: 4px 0;">
        <span style="color: var(--text-secondary);">Excess Kurtosis</span>
        <strong style="color: var(--color-blue); font-family: monospace;">${stats.kurtosis.toFixed(2)} (Fat tails)</strong>
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Quantiles (bps)</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 12px;">
        <div style="display: flex; justify-content: space-between;"><span>p1:</span> <strong style="color:var(--color-red)">${stats.quantiles.p1.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p99:</span> <strong style="color:var(--color-green)">${stats.quantiles.p99.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p5:</span> <strong style="color:var(--color-red)">${stats.quantiles.p5.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p95:</span> <strong style="color:var(--color-green)">${stats.quantiles.p95.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p25:</span> <strong>${stats.quantiles.p25.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between;"><span>p75:</span> <strong>${stats.quantiles.p75.toFixed(1)}</strong></div>
        <div style="display: flex; justify-content: space-between; grid-column: span 2; border-top: 1px solid var(--border-color); padding-top: 4px;">
          <span>Median (p50):</span> <strong style="color: var(--color-blue)">${stats.quantiles.p50.toFixed(1)} bps</strong>
        </div>
      </div>
    `;
  }

  slider.addEventListener('input', () => {
    currentWindow = Number(slider.value);
    const days = Math.round(currentWindow / 24);
    windowLabel.textContent = `${currentWindow}h (${days}d)`;
    renderRollingVol();
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
