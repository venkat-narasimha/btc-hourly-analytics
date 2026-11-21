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
import { renderInfoTooltip, renderInspectTrigger } from '../ui/tooltip';

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
      <div class="ctl" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 0;">
        <div class="field">
          <label>Metric</label>
          <select id="heatmap-metric-select">
            <option value="mean_return">Mean Return (bps)</option>
            <option value="volatility">Volatility (σ, bps)</option>
            <option value="win_rate">Win Rate (%)</option>
            <option value="total_volume">Total Volume (BTC)</option>
            <option value="taker_buy_ratio">Taker Buy Ratio</option>
            <option value="mean_hl_range">Mean H-L Range (bps)</option>
          </select>
          <span id="heatmap-selector-tooltip"></span>
        </div>
        <span class="badge amber" style="margin-left: auto;">
          ~360 obs / cell · multiple-testing caution · returns in UTC
        </span>
      </div>
      <div class="card chart-card" style="display: flex; flex-direction: column;">
        <div class="hd chart-card-header">
          <div>
            <h3 class="chart-card-title" style="margin: 0; display: flex; align-items: center; gap: 6px;">
              <span>Hourly Seasonality Heatmap</span>
              <span id="heatmap-header-actions" style="display: inline-flex; align-items: center; gap: 4px;"></span>
            </h3>
            <small class="chart-card-subtitle text-muted">Day of Week × Hour of Day (UTC)</small>
          </div>
        </div>
        <div id="heatmap-chart" class="bd chart-card-body no-padding" style="width: 100%; height: 480px; min-height: 480px;"></div>
      </div>
    </div>
  `;

  const metricSelect = container.querySelector('#heatmap-metric-select') as HTMLSelectElement;
  metricSelect.value = initialMetric;

  const chartEl = container.querySelector('#heatmap-chart') as HTMLElement;
  const headerActionsEl = container.querySelector('#heatmap-header-actions') as HTMLElement;
  const chart = echarts.init(chartEl);

  chart.on('click', (params: any) => {
    if (!params.data) return;
    const [hIdx, dIdx] = params.data;
    container.dispatchEvent(
      new CustomEvent('inspect-request', {
        bubbles: true,
        detail: {
          defId: `heatmap.${currentMetric}`,
          metric: currentMetric,
          target: `${dIdx}:${hIdx}`,
        },
      })
    );
  });

  const hours = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

  function renderChart() {
    const colors = getChartTheme(currentTheme);
    const cells = computeHeatmap(currentData, currentMetric);
    const metricInfo = METRIC_INFO[currentMetric];

    const selectorTooltipEl = container.querySelector('#heatmap-selector-tooltip') as HTMLElement;
    if (selectorTooltipEl) {
      selectorTooltipEl.innerHTML = renderInfoTooltip({
        defId: `heatmap.${currentMetric}`,
        metric: currentMetric,
        title: `Heatmap Metric: ${metricInfo.label}`,
        description: `Computes ${metricInfo.label} across all historical bars matching (Day of Week, Hour of Day).`,
        position: 'bottom',
      });
    }

    if (headerActionsEl) {
      headerActionsEl.innerHTML = `
        ${renderInfoTooltip({
          defId: `heatmap.${currentMetric}`,
          metric: currentMetric,
          title: `Hourly Seasonality Heatmap (${metricInfo.label})`,
          description: `Full bivariate cross-tabulation mapping ${metricInfo.label} across all 168 hours of the trading week. Click any cell to inspect.`,
          caveat: 'Multiple Testing Hazard: Testing 168 cells simultaneously will yield seemingly significant statistical anomalies purely by chance.',
          position: 'bottom',
        })}
        ${renderInspectTrigger(`heatmap.${currentMetric}`, {
          metric: currentMetric,
          title: 'Inspect 7×24 Heatmap Matrix',
        })}
      `;
    }

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
            ? ['#E02424', '#ECE4D0', '#0E9F6E']
            : ['#F87171', '#181410', '#34D399'],
        },
      };
    } else {
      visualMapOpts = {
        ...visualMapOpts,
        inRange: {
          color: currentTheme === 'light'
            ? ['#ECE4D0', '#FDE68A', '#F59E0B', '#D97706', '#92400E']
            : ['#181410', '#3D2808', '#78350F', '#D97706', '#FBBF24'],
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
        splitArea: { show: false },
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        data: DOW_LABELS,
        splitArea: { show: false },
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      visualMap: visualMapOpts,
      series: [
        {
          type: 'heatmap',
          data: seriesData,
          itemStyle: {
            borderColor: currentTheme === 'light' ? '#FFFFFF' : '#181410',
            borderWidth: 1.5,
            borderRadius: 2,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.3)',
              borderColor: colors.textColor,
              borderWidth: 1.5,
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
