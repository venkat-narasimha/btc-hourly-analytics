/**
 * Seasonality Chart component using Apache ECharts.
 * Shows:
 * - Hour-of-Day (0-23 UTC) seasonality bar chart
 * - Day-of-Week (Mon-Sun UTC) seasonality bar chart
 * - Metric dropdown
 * - Session overlay toggle (Asia 00-08, Europe 07-16, US 13-22 UTC)
 * - Tooltip with sample size n
 * - Zero line
 * - Light ↔ Dark theme dynamic styling
 * - Persistent caption: "UTC buckets · returns, not prices · descriptive, not predictive."
 */

import * as echarts from 'echarts';
import type { KlineRow, SeasonalityMetric, Theme } from '../types';
import {
  computeSeasonality,
  DOW_LABELS,
  METRIC_INFO,
} from '../stats/aggregations';
import { TRADING_SESSIONS } from '../stats/analytics';
import { getChartTheme } from '../ui/theme';

export interface SeasonalityChartInstance {
  updateData(data: KlineRow[]): void;
  setMetric(metric: SeasonalityMetric): void;
  setTheme(theme: Theme): void;
  destroy(): void;
}

export function createSeasonalityView(
  container: HTMLElement,
  initialData: KlineRow[],
  initialMetric: SeasonalityMetric = 'mean_return',
  initialTheme: Theme = 'light'
): SeasonalityChartInstance {
  let currentData = initialData;
  let currentMetric: SeasonalityMetric = initialMetric;
  let currentTheme: Theme = initialTheme;
  let showSessions = false;

  container.innerHTML = `
    <div class="seasonality-view" style="display: flex; flex-direction: column; gap: 16px; width: 100%;">
      <div class="filterbar seasonality-controls" style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; padding: 4px 0;">
        <div style="display: flex; gap: 12px; align-items: center;">
          <label style="font-size: var(--text-sm); color: var(--text-secondary); font-weight: 500;">Metric:</label>
          <select id="seasonality-metric-select" class="styled-select" style="padding: 6px 10px; font-size: var(--text-sm); cursor: pointer;">
            <option value="mean_return">Mean Return (bps)</option>
            <option value="volatility">Volatility (σ, bps)</option>
            <option value="win_rate">Win Rate (%)</option>
            <option value="total_volume">Total Volume (BTC)</option>
            <option value="taker_buy_ratio">Taker Buy Ratio</option>
            <option value="mean_hl_range">Mean H-L Range (bps)</option>
          </select>

          <label style="display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); color: var(--text-secondary); cursor: pointer; margin-left: 12px;">
            <input type="checkbox" id="session-overlay-toggle" />
            <span>Trading Sessions Overlay</span>
          </label>
        </div>

        <span class="text-muted" style="font-size: var(--text-xs); color: var(--text-muted); font-style: italic;">
          UTC buckets · returns, not prices · descriptive, not predictive.
        </span>
      </div>

      <div class="seasonality-charts-grid" style="display: flex; flex-direction: column; gap: 16px; width: 100%;">
        <div class="chart-card" style="display: flex; flex-direction: column;">
          <div class="chart-card-header">
            <h3 class="chart-card-title" style="font-size: var(--text-md); font-weight: 600; color: var(--text-primary); margin: 0;">Hour of Day (UTC)</h3>
          </div>
          <div id="hour-chart" class="chart-card-body no-padding" style="width: 100%; height: 320px; min-height: 320px;"></div>
        </div>
        <div class="chart-card" style="display: flex; flex-direction: column;">
          <div class="chart-card-header">
            <h3 class="chart-card-title" style="font-size: var(--text-md); font-weight: 600; color: var(--text-primary); margin: 0;">Day of Week (UTC)</h3>
          </div>
          <div id="dow-chart" class="chart-card-body no-padding" style="width: 100%; height: 320px; min-height: 320px;"></div>
        </div>
      </div>
    </div>
  `;

  const metricSelect = container.querySelector('#seasonality-metric-select') as HTMLSelectElement;
  metricSelect.value = initialMetric;

  const sessionToggle = container.querySelector('#session-overlay-toggle') as HTMLInputElement;

  const hourChartEl = container.querySelector('#hour-chart') as HTMLElement;
  const dowChartEl = container.querySelector('#dow-chart') as HTMLElement;

  const hourChart = echarts.init(hourChartEl);
  const dowChart = echarts.init(dowChartEl);

  function renderCharts() {
    const colors = getChartTheme(currentTheme);
    const hourData = computeSeasonality(currentData, 'hour', currentMetric);
    const dowData = computeSeasonality(currentData, 'dow', currentMetric);
    const metricInfo = METRIC_INFO[currentMetric];

    // Hour of day chart options
    const hourX = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);
    const hourY = hourData.map(d => Number(d.value.toFixed(2)));

    // Mark areas for sessions if toggled
    const markAreas = showSessions
      ? TRADING_SESSIONS.map(s => ([
          {
            name: s.name,
            xAxis: `${s.startHour.toString().padStart(2, '0')}:00`,
            itemStyle: {
              color: s.color.replace(')', ', 0.12)').replace('rgb', 'rgba').replace('#3b82f6', 'rgba(59, 130, 246, 0.12)').replace('#10b981', 'rgba(16, 185, 129, 0.12)').replace('#f59e0b', 'rgba(245, 158, 11, 0.12)'),
            },
            label: {
              show: true,
              color: colors.textSecondary,
              fontSize: 10,
              position: 'insideTop',
            },
          },
          {
            xAxis: `${Math.min(s.endHour, 23).toString().padStart(2, '0')}:00`,
          },
        ]))
      : [];

    hourChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        formatter: (params: any) => {
          const item = params[0];
          const idx = item.dataIndex;
          const stat = hourData[idx];
          return `
            <div style="font-weight: 600; margin-bottom: 4px;">Hour ${hourX[idx]} UTC</div>
            <div>${metricInfo.label}: <strong>${stat.value.toFixed(2)} ${metricInfo.unit}</strong></div>
            <div style="color: ${colors.textSecondary}; font-size: 11px;">Sample size n: ${stat.n.toLocaleString()}</div>
          `;
        },
      },
      grid: { left: 55, right: 20, top: 25, bottom: 30 },
      xAxis: {
        type: 'category',
        data: hourX,
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: metricInfo.unit,
        nameTextStyle: { color: colors.textSecondary, fontSize: 11 },
        splitLine: { lineStyle: { color: colors.gridLineColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: hourY,
          itemStyle: {
            color: (params: any) => {
              const v = params.value;
              if (currentMetric === 'mean_return') {
                return v >= 0 ? '#10b981' : '#ef4444';
              }
              return currentTheme === 'light' ? '#2563eb' : '#60a5fa';
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 0, lineStyle: { color: colors.borderColor, type: 'dashed' } }],
          },
          markArea: {
            data: markAreas,
          },
        },
      ],
    }, true);

    // Day of week chart options
    const dowY = dowData.map(d => Number(d.value.toFixed(2)));
    dowChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        formatter: (params: any) => {
          const item = params[0];
          const idx = item.dataIndex;
          const stat = dowData[idx];
          return `
            <div style="font-weight: 600; margin-bottom: 4px;">${DOW_LABELS[idx]} (UTC)</div>
            <div>${metricInfo.label}: <strong>${stat.value.toFixed(2)} ${metricInfo.unit}</strong></div>
            <div style="color: ${colors.textSecondary}; font-size: 11px;">Sample size n: ${stat.n.toLocaleString()}</div>
          `;
        },
      },
      grid: { left: 55, right: 20, top: 25, bottom: 30 },
      xAxis: {
        type: 'category',
        data: DOW_LABELS,
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: metricInfo.unit,
        nameTextStyle: { color: colors.textSecondary, fontSize: 11 },
        splitLine: { lineStyle: { color: colors.gridLineColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: dowY,
          itemStyle: {
            color: (params: any) => {
              const v = params.value;
              if (currentMetric === 'mean_return') {
                return v >= 0 ? '#10b981' : '#ef4444';
              }
              return currentTheme === 'light' ? '#0284c7' : '#38bdf8';
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 0, lineStyle: { color: colors.borderColor, type: 'dashed' } }],
          },
        },
      ],
    }, true);
  }

  metricSelect.addEventListener('change', () => {
    currentMetric = metricSelect.value as SeasonalityMetric;
    renderCharts();
  });

  sessionToggle.addEventListener('change', () => {
    showSessions = sessionToggle.checked;
    renderCharts();
  });

  const ro = new ResizeObserver(() => {
    hourChart.resize();
    dowChart.resize();
  });
  ro.observe(container);

  renderCharts();

  return {
    updateData(data: KlineRow[]) {
      currentData = data;
      renderCharts();
    },
    setMetric(metric: SeasonalityMetric) {
      currentMetric = metric;
      metricSelect.value = metric;
      renderCharts();
    },
    setTheme(th: Theme) {
      currentTheme = th;
      renderCharts();
    },
    destroy() {
      ro.disconnect();
      hourChart.dispose();
      dowChart.dispose();
    },
  };
}
