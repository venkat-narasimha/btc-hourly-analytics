/**
 * 7x24 Heatmap (Day of Week x Hour of Day) using ECharts.
 * Shows seasonal return/volatility/volume across every hour of the week.
 */

import * as echarts from 'echarts';
import type { KlineRow, SeasonalityMetric } from '../types';
import { computeHeatmap } from '../stats/analytics';
import { DOW_LABELS, METRIC_INFO } from '../stats/aggregations';

export interface HeatmapChartInstance {
  updateData(data: KlineRow[]): void;
  setMetric(metric: SeasonalityMetric): void;
  destroy(): void;
}

export function createHeatmapView(
  container: HTMLElement,
  initialData: KlineRow[],
  initialMetric: SeasonalityMetric = 'mean_return'
): HeatmapChartInstance {
  let currentData = initialData;
  let currentMetric: SeasonalityMetric = initialMetric;

  container.innerHTML = `
    <div class="heatmap-view" style="display: flex; flex-direction: column; height: 100%; gap: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; gap: 12px; align-items: center;">
          <label style="font-size: 13px; color: #94a3b8; font-weight: 500;">Metric:</label>
          <select id="heatmap-metric-select" style="background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 6px 10px; font-size: 13px; cursor: pointer;">
            <option value="mean_return">Mean Return (bps)</option>
            <option value="volatility">Volatility (σ, bps)</option>
            <option value="win_rate">Win Rate (%)</option>
            <option value="total_volume">Total Volume (BTC)</option>
            <option value="taker_buy_ratio">Taker Buy Ratio</option>
            <option value="mean_hl_range">Mean H-L Range (bps)</option>
          </select>
        </div>
        <div style="font-size: 12px; color: #64748b; font-style: italic;">
          ~350–360 observations per cell · beware multiple testing & noise · returns in UTC
        </div>
      </div>
      <div class="chart-panel" style="background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 12px; flex: 1; min-height: 480px;">
        <div id="heatmap-chart" style="width: 100%; height: 100%; min-height: 460px;"></div>
      </div>
    </div>
  `;

  const metricSelect = container.querySelector('#heatmap-metric-select') as HTMLSelectElement;
  metricSelect.value = initialMetric;

  const chartEl = container.querySelector('#heatmap-chart') as HTMLElement;
  const chart = echarts.init(chartEl, 'dark');

  const hours = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

  function renderChart() {
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
      bottom: '10px',
      textStyle: { color: '#94a3b8' },
    };

    if (currentMetric === 'mean_return') {
      const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal)) || 10;
      visualMapOpts = {
        ...visualMapOpts,
        min: -absMax,
        max: absMax,
        inRange: {
          color: ['#ef4444', '#1e293b', '#10b981'],
        },
      };
    } else {
      visualMapOpts = {
        ...visualMapOpts,
        inRange: {
          color: ['#0f172a', '#1e3a8a', '#3b82f6', '#38bdf8', '#f8fafc'],
        },
      };
    }

    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        formatter: (params: any) => {
          const [hIdx, dIdx, val, n] = params.data;
          return `
            <div style="font-weight: 600; margin-bottom: 4px;">${DOW_LABELS[dIdx]} ${hours[hIdx]} UTC</div>
            <div>${metricInfo.label}: <strong>${val} ${metricInfo.unit}</strong></div>
            <div style="color: #94a3b8; font-size: 11px;">Sample size n: ${n.toLocaleString()} obs</div>
          `;
        },
      },
      grid: { top: 30, right: 30, bottom: 65, left: 60 },
      xAxis: {
        type: 'category',
        data: hours,
        splitArea: { show: true },
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        data: DOW_LABELS,
        splitArea: { show: true },
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      visualMap: visualMapOpts,
      series: [
        {
          type: 'heatmap',
          data: seriesData,
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
              borderColor: '#ffffff',
              borderWidth: 1,
            },
          },
        },
      ],
    });
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
    destroy() {
      ro.disconnect();
      chart.dispose();
    },
  };
}
