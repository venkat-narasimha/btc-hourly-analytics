/**
 * 7x24 Heatmap (Day of Week x Hour of Day) using ECharts.
 * Shows seasonal return/volatility/volume across every hour of the week.
 * Supports dynamic light and dark theme switching.
 */

import * as echarts from 'echarts';
import type { KlineRow, SeasonalityMetric, Theme } from '../types';
import { computeHeatmap } from '../stats/analytics';
import { DOW_LABELS, METRIC_INFO } from '../stats/aggregations';
import { getChartTheme } from '../ui/theme';
import { renderInfoTooltip } from '../ui/tooltip';

export interface HeatmapChartInstance {
  updateData(data: KlineRow[]): void;
  setMetric(metric: SeasonalityMetric): void;
  setTheme(theme: Theme): void;
  destroy(): void;
}

export function createHeatmapView(
  container: HTMLElement,
  initialData: KlineRow[],
  initialMetric: SeasonalityMetric = 'mean_return',
  initialTheme: Theme = 'light'
): HeatmapChartInstance {
  let currentData = initialData;
  let currentMetric: SeasonalityMetric = initialMetric;
  let currentTheme: Theme = initialTheme;

  container.innerHTML = `
    <div class="heatmap-view" style="display: flex; flex-direction: column; gap: 16px; width: 100%;">
      <div class="filterbar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div class="filterbar-group" style="display: flex; gap: 12px; align-items: center;">
          <label class="filterbar-label" style="font-size: var(--text-sm); color: var(--text-secondary); font-weight: 500;">Metric:</label>
          <select id="heatmap-metric-select" class="styled-select" style="padding: 6px 10px; font-size: var(--text-sm); cursor: pointer;">
            <option value="mean_return">Mean Return (bps)</option>
            <option value="volatility">Volatility (σ, bps)</option>
            <option value="win_rate">Win Rate (%)</option>
            <option value="total_volume">Total Volume (BTC)</option>
            <option value="taker_buy_ratio">Taker Buy Ratio</option>
            <option value="mean_hl_range">Mean H-L Range (bps)</option>
          </select>
          ${renderInfoTooltip({
            title: 'Heatmap Metric Aggregation',
            description: 'Computes the specified summary statistic across all samples sharing the same (Day of Week, Hour of Day) coordinate.',
            formula: 'Cell(d, h) = Metric({ Bars where Day=d and Hour=h })',
            position: 'bottom',
          })}
        </div>
        <span class="text-muted" style="font-size: var(--text-xs); color: var(--text-muted); font-style: italic;">
          ~350–360 observations per cell · beware multiple testing & noise · returns in UTC
        </span>
      </div>
      <div class="chart-card" style="display: flex; flex-direction: column;">
        <div class="chart-card-header">
          <div>
            <h3 class="chart-card-title" style="font-size: var(--text-md); font-weight: 600; color: var(--text-primary); margin: 0;">
              Hourly Seasonality Heatmap
              ${renderInfoTooltip({
                title: '7×24 Interaction Grid (168 Cells)',
                description: 'Full bivariate cross-tabulation mapping market behavior across all 168 hours of the trading week.',
                formula: 'n ≈ 350 to 360 observations per cell',
                caveat: 'Multiple Testing Hazard: Testing 168 cells simultaneously will yield seemingly significant statistical anomalies purely by chance without false discovery rate adjustments.',
                position: 'bottom',
              })}
            </h3>
            <span class="chart-card-subtitle" style="font-size: var(--text-xs); color: var(--text-muted);">Day of Week × Hour of Day (UTC)</span>
          </div>
        </div>
        <div id="heatmap-chart" class="chart-card-body no-padding" style="width: 100%; height: 480px; min-height: 480px;"></div>
      </div>
    </div>
  `;

  const metricSelect = container.querySelector('#heatmap-metric-select') as HTMLSelectElement;
  metricSelect.value = initialMetric;

  const chartEl = container.querySelector('#heatmap-chart') as HTMLElement;
  const chart = echarts.init(chartEl);

  const hours = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

  function renderChart() {
    const colors = getChartTheme(currentTheme);
    const cells = computeHeatmap(currentData, currentMetric);
    const metricInfo = METRIC_INFO[currentMetric];

    // Data in format [hourIdx, dowIdx, value, n]
    const seriesData = cells.map(c => [c.hour, c.dow, Number(c.value.toFixed(2)), c.n]);

    const values = cells.map(c => c.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    // Color gradient setup
    let visualMapOpts: any = {
      min: minVal,
      max: maxVal,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: '8px',
      textStyle: { color: colors.textSecondary },
    };

    if (currentMetric === 'mean_return') {
      const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal)) || 10;
      visualMapOpts = {
        ...visualMapOpts,
        min: -absMax,
        max: absMax,
        inRange: {
          color: currentTheme === 'light'
            ? ['#ef4444', '#f1f5f9', '#10b981']
            : ['#ef4444', '#1e293b', '#10b981'],
        },
      };
    } else {
      visualMapOpts = {
        ...visualMapOpts,
        inRange: {
          color: currentTheme === 'light'
            ? ['#f8fafc', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a']
            : ['#0f172a', '#1e3a8a', '#3b82f6', '#38bdf8', '#f8fafc'],
        },
      };
    }

    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        formatter: (params: any) => {
          const [hIdx, dIdx, val, n] = params.data;
          return `
            <div style="font-weight: 600; margin-bottom: 4px;">${DOW_LABELS[dIdx]} ${hours[hIdx]} UTC</div>
            <div>${metricInfo.label}: <strong>${val} ${metricInfo.unit}</strong></div>
            <div style="color: ${colors.textSecondary}; font-size: 11px;">Sample size n: ${n.toLocaleString()} obs</div>
          `;
        },
      },
      grid: { top: 30, right: 30, bottom: 85, left: 60 },
      xAxis: {
        type: 'category',
        data: hours,
        splitArea: {
          show: true,
          areaStyle: {
            color: currentTheme === 'light'
              ? ['rgba(0, 0, 0, 0.01)', 'rgba(0, 0, 0, 0.03)']
              : ['rgba(255, 255, 255, 0.01)', 'rgba(255, 255, 255, 0.02)'],
          },
        },
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        data: DOW_LABELS,
        splitArea: {
          show: true,
          areaStyle: {
            color: currentTheme === 'light'
              ? ['rgba(0, 0, 0, 0.01)', 'rgba(0, 0, 0, 0.03)']
              : ['rgba(255, 255, 255, 0.01)', 'rgba(255, 255, 255, 0.02)'],
          },
        },
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      visualMap: visualMapOpts,
      series: [
        {
          type: 'heatmap',
          data: seriesData,
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.3)',
              borderColor: colors.textColor,
              borderWidth: 1,
            },
          },
        },
      ],
    }, true);
  }

  metricSelect.addEventListener('change', () => {
    currentMetric = metricSelect.value as SeasonalityMetric;
    renderChart();
  });

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(container);

  renderChart();

  return {
    updateData(data: KlineRow[]) {
      currentData = data;
      renderChart();
    },
    setMetric(metric: SeasonalityMetric) {
      currentMetric = metric;
      metricSelect.value = metric;
      renderChart();
    },
    setTheme(th: Theme) {
      currentTheme = th;
      renderChart();
    },
    destroy() {
      ro.disconnect();
      chart.dispose();
    },
  };
}
