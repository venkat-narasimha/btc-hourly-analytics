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
import { renderInfoTooltip, renderInspectTrigger } from '../ui/tooltip';

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
      <div class="ctl seasonality-controls" style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 0;">
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
          <div class="field">
            <label>Metric</label>
            <select id="seasonality-metric-select">
              <option value="mean_return">Mean Return (bps)</option>
              <option value="volatility">Volatility (σ, bps)</option>
              <option value="win_rate">Win Rate (%)</option>
              <option value="total_volume">Total Volume (BTC)</option>
              <option value="taker_buy_ratio">Taker Buy Ratio</option>
              <option value="mean_hl_range">Mean H-L Range (bps)</option>
            </select>
            ${renderInfoTooltip({
              title: 'Seasonality Metric Computation',
              description: 'Selects the aggregation statistic evaluated across recurring cyclical time buckets.',
              caveat: 'Averages span multiple bull/bear market regimes and may mask regime-specific variance.',
              position: 'bottom',
            })}
          </div>

          <label class="switch" style="display: inline-flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="session-overlay-toggle" />
            <span class="tr"></span>
            <span>Trading Sessions Overlay</span>
          </label>
          ${renderInfoTooltip({
            title: 'Global Trading Sessions (UTC)',
            description: 'Color-coded bands marking Asia (00:00–08:00 UTC), Europe (07:00–16:00 UTC), and US (13:00–22:00 UTC) trading hours.',
            caveat: 'Peak cross-continental liquidity and volatility cluster during the London/New York session overlap (13:00–16:00 UTC).',
            position: 'bottom',
          })}
        </div>

        <span class="badge amber" style="margin-left: auto;">
          UTC buckets · descriptive, not predictive
        </span>
      </div>

      <div class="seasonality-charts-grid" style="display: flex; flex-direction: column; gap: 16px; width: 100%;">
        <div class="card chart-card" style="display: flex; flex-direction: column;">
          <div class="hd chart-card-header">
            <h3 class="chart-card-title" style="margin: 0; display: flex; align-items: center; gap: 6px;">
              <span>Hour of Day (UTC)</span>
              <span id="hour-header-actions" style="display: inline-flex; align-items: center; gap: 4px;"></span>
            </h3>
          </div>
          <div id="hour-chart" class="bd chart-card-body no-padding" style="width: 100%; height: 320px; min-height: 320px;"></div>
        </div>
        <div class="card chart-card" style="display: flex; flex-direction: column;">
          <div class="hd chart-card-header">
            <h3 class="chart-card-title" style="margin: 0; display: flex; align-items: center; gap: 6px;">
              <span>Day of Week (UTC)</span>
              <span id="dow-header-actions" style="display: inline-flex; align-items: center; gap: 4px;"></span>
            </h3>
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
  const hourActionsEl = container.querySelector('#hour-header-actions') as HTMLElement;
  const dowActionsEl = container.querySelector('#dow-header-actions') as HTMLElement;

  const hourChart = echarts.init(hourChartEl);
  const dowChart = echarts.init(dowChartEl);

  hourChart.on('click', (params: any) => {
    container.dispatchEvent(
      new CustomEvent('inspect-request', {
        bubbles: true,
        detail: {
          defId: `seasonality.${currentMetric}`,
          bucket: 'hour',
          metric: currentMetric,
          target: String(params.dataIndex),
        },
      })
    );
  });

  dowChart.on('click', (params: any) => {
    container.dispatchEvent(
      new CustomEvent('inspect-request', {
        bubbles: true,
        detail: {
          defId: `seasonality.${currentMetric}`,
          bucket: 'dow',
          metric: currentMetric,
          target: String(params.dataIndex),
        },
      })
    );
  });

  function renderCharts() {
    const colors = getChartTheme(currentTheme);
    const hourData = computeSeasonality(currentData, 'hour', currentMetric);
    const dowData = computeSeasonality(currentData, 'dow', currentMetric);
    const metricInfo = METRIC_INFO[currentMetric];

    if (hourActionsEl) {
      hourActionsEl.innerHTML = `
        ${renderInfoTooltip({
          defId: `seasonality.${currentMetric}`,
          bucket: 'hour',
          metric: currentMetric,
          title: `Diurnal Seasonality (${metricInfo.label})`,
          description: `Hourly seasonality aggregation for ${metricInfo.label} across 24 UTC hours.`,
          caveat: 'Diurnal patterns are descriptive and have low explanatory power on any single future trading day.',
          position: 'bottom',
        })}
        ${renderInspectTrigger(`seasonality.${currentMetric}`, {
          bucket: 'hour',
          metric: currentMetric,
          title: 'Inspect Hour Seasonality Aggregate',
        })}
      `;
    }

    if (dowActionsEl) {
      dowActionsEl.innerHTML = `
        ${renderInfoTooltip({
          defId: `seasonality.${currentMetric}`,
          bucket: 'dow',
          metric: currentMetric,
          title: `Day-of-Week Seasonality (${metricInfo.label})`,
          description: `Day-of-week seasonality aggregation for ${metricInfo.label} across Monday–Sunday.`,
          position: 'bottom',
        })}
        ${renderInspectTrigger(`seasonality.${currentMetric}`, {
          bucket: 'dow',
          metric: currentMetric,
          title: 'Inspect DOW Seasonality Aggregate',
        })}
      `;
    }

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
