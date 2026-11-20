/**
 * Order Flow Component.
 * Visualizes:
 * - Taker Buy Ratio by Hour of Day (bar chart)
 * - Cumulative Taker Delta Line Chart: Σ(2 * taker_buy_volume - volume) in BTC
 * - Supports dynamic light and dark theme switching
 */

import * as echarts from 'echarts';
import type { KlineRow, Theme } from '../types';
import { computeCumulativeTakerDelta } from '../stats/analytics';
import { computeSeasonality } from '../stats/aggregations';
import { getChartTheme } from '../ui/theme';
import { renderInfoTooltip } from '../ui/tooltip';

export interface FlowViewInstance {
  updateData(data: KlineRow[]): void;
  setTheme(theme: Theme): void;
  destroy(): void;
}

export function createFlowView(
  container: HTMLElement,
  initialData: KlineRow[],
  initialTheme: Theme = 'light'
): FlowViewInstance {
  let currentData = initialData;
  let currentTheme: Theme = initialTheme;

  container.innerHTML = `
    <div class="page-wrapper tab-enter flow-view" style="display: flex; flex-direction: column; gap: 16px; height: 100%;">
      <!-- Cumulative Taker Delta Line -->
      <div class="chart-card" style="flex: 1; display: flex; flex-direction: column; min-height: 260px;">
        <div class="chart-card-header">
          <div>
            <h3 class="chart-card-title" style="margin: 0;">
              Cumulative Taker Delta (Net Aggressive Order Flow)
              ${renderInfoTooltip({
                title: 'Cumulative Volume Delta (CVD)',
                description: 'Measures running net aggressive market buying vs aggressive selling in contracts/BTC.',
                formula: '\\Delta_t = 2 \\times V_{\\text{taker\\_buy}} - V_{\\text{total}}, \\quad \\text{CVD}_T = \\sum_{t=1}^T \\Delta_t',
                caveat: 'Taker transactions only. Passive limit order liquidity providers represent the exact equal and opposite side of every executed fill.',
                position: 'bottom',
              })}
            </h3>
            <div class="chart-card-subtitle text-muted">
              Formula: Σ(2 · taker_buy_volume − volume) in BTC
            </div>
          </div>
          <div id="net-delta-stat" class="font-tabular" style="font-size: var(--text-sm); font-weight: 600; font-family: var(--font-mono, monospace);"></div>
        </div>
        <div id="cum-delta-chart" class="chart-card-body no-padding" style="flex: 1; width: 100%; min-height: 200px;"></div>
      </div>

      <!-- Hourly Taker Buy Ratio Bar -->
      <div class="chart-card" style="flex: 1; display: flex; flex-direction: column; min-height: 240px;">
        <div class="chart-card-header">
          <div>
            <h3 class="chart-card-title" style="margin: 0;">
              Hourly Taker Buy Ratio by Hour of Day (UTC)
              ${renderInfoTooltip({
                title: 'Hourly Taker Buy Ratio (TBR)',
                description: 'Proportion of aggregate traded volume initiated by aggressive market buy orders across each UTC hour.',
                formula: '\\text{TBR}_h = \\frac{\\sum_{t \\in h} V_{\\text{taker\\_buy}}}{\\sum_{t \\in h} V_{\\text{total}}}',
                caveat: 'Values > 0.50 indicate aggressive taker buying. Spikes frequently align with perpetual funding rate settlement boundaries (00:00, 08:00, 16:00 UTC).',
                position: 'bottom',
              })}
            </h3>
            <div class="chart-card-subtitle text-muted">
              Ratio-of-sums: Σtaker_buy_volume / Σvolume (&gt;0.50 indicates net aggressive buying)
            </div>
          </div>
        </div>
        <div id="hourly-flow-chart" class="chart-card-body no-padding" style="flex: 1; width: 100%; min-height: 190px;"></div>
      </div>
    </div>
  `;

  const cumChartEl = container.querySelector('#cum-delta-chart') as HTMLElement;
  const hourlyChartEl = container.querySelector('#hourly-flow-chart') as HTMLElement;
  const netDeltaLabel = container.querySelector('#net-delta-stat') as HTMLElement;

  const cumChart = echarts.init(cumChartEl);
  const hourlyChart = echarts.init(hourlyChartEl);

  function renderCharts() {
    const colors = getChartTheme(currentTheme);

    // 1. Cumulative Taker Delta
    const deltaPoints = computeCumulativeTakerDelta(currentData);
    const times = deltaPoints.map(p => new Date(p.timeMs).toISOString().replace('.000Z', '').replace('T', ' '));
    const cumVals = deltaPoints.map(p => Math.round(p.cumDelta));

    if (deltaPoints.length > 0) {
      const last = deltaPoints[deltaPoints.length - 1].cumDelta;
      netDeltaLabel.textContent = `Net: ${last >= 0 ? '+' : ''}${last.toLocaleString(undefined, { maximumFractionDigits: 0 })} BTC`;
      netDeltaLabel.style.color = last >= 0 ? 'var(--color-positive)' : 'var(--color-negative)';
    }

    const lineColor = currentTheme === 'light' ? '#2563eb' : '#38bdf8';
    const areaStart = currentTheme === 'light' ? 'rgba(37, 99, 235, 0.20)' : 'rgba(56, 189, 248, 0.25)';

    cumChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        formatter: (params: any) => {
          const idx = params[0].dataIndex;
          const p = deltaPoints[idx];
          return `
            <div>${times[idx]} UTC</div>
            <div>Bar Delta: <strong>${p.delta >= 0 ? '+' : ''}${p.delta.toFixed(1)} BTC</strong></div>
            <div>Cumulative: <strong>${p.cumDelta >= 0 ? '+' : ''}${p.cumDelta.toFixed(1)} BTC</strong></div>
          `;
        },
      },
      grid: { left: 65, right: 20, top: 15, bottom: 25 },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: 'BTC',
        nameTextStyle: { color: colors.textSecondary },
        splitLine: { lineStyle: { color: colors.gridLineColor } },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: 11,
          formatter: (v: number) => `${(v / 1000).toFixed(0)}k`,
        },
      },
      series: [
        {
          type: 'line',
          data: cumVals,
          showSymbol: false,
          lineStyle: { color: lineColor, width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: areaStart },
              { offset: 1, color: 'rgba(56, 189, 248, 0.0)' },
            ]),
          },
        },
      ],
    }, true);

    // 2. Hourly Taker Buy Ratio
    const hourlyData = computeSeasonality(currentData, 'hour', 'taker_buy_ratio');
    const hourLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);
    const ratios = hourlyData.map(d => Number((d.value * 100).toFixed(2))); // in %

    hourlyChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        formatter: (params: any) => {
          const idx = params[0].dataIndex;
          const val = ratios[idx];
          const n = hourlyData[idx].n;
          return `
            <div>Hour ${hourLabels[idx]} UTC</div>
            <div>Taker Buy Ratio: <strong>${val.toFixed(2)}%</strong></div>
            <div style="color: ${colors.textSecondary}; font-size: 11px;">Sample size n: ${n.toLocaleString()}</div>
          `;
        },
      },
      grid: { left: 55, right: 20, top: 20, bottom: 25 },
      xAxis: {
        type: 'category',
        data: hourLabels,
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        min: 45,
        max: 55,
        name: '%',
        nameTextStyle: { color: colors.textSecondary },
        splitLine: { lineStyle: { color: colors.gridLineColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: ratios,
          itemStyle: {
            color: (params: any) => (params.value >= 50.0 ? '#10b981' : '#f59e0b'),
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 50.0, lineStyle: { color: colors.textSecondary, type: 'dashed' } }],
          },
        },
      ],
    }, true);
  }

  const ro = new ResizeObserver(() => {
    cumChart.resize();
    hourlyChart.resize();
  });
  ro.observe(container);

  renderCharts();

  return {
    updateData(data: KlineRow[]) {
      currentData = data;
      renderCharts();
    },
    setTheme(th: Theme) {
      currentTheme = th;
      renderCharts();
    },
    destroy() {
      ro.disconnect();
      cumChart.dispose();
      hourlyChart.dispose();
    },
  };
}
