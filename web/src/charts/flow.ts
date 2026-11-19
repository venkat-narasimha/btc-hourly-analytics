/**
 * Order Flow Component.
 * Visualizes:
 * - Taker Buy Ratio by Hour of Day (bar chart)
 * - Cumulative Taker Delta Line Chart: Σ(2 * taker_buy_volume - volume) in BTC
 */

import * as echarts from 'echarts';
import type { KlineRow } from '../types';
import { computeCumulativeTakerDelta } from '../stats/analytics';
import { computeSeasonality } from '../stats/aggregations';

export interface FlowViewInstance {
  updateData(data: KlineRow[]): void;
  destroy(): void;
}

export function createFlowView(
  container: HTMLElement,
  initialData: KlineRow[]
): FlowViewInstance {
  let currentData = initialData;

  container.innerHTML = `
    <div class="flow-view" style="display: flex; flex-direction: column; gap: 16px; height: 100%;">
      <!-- Cumulative Taker Delta Line -->
      <div class="chart-panel" style="background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 14px; flex: 1; display: flex; flex-direction: column; min-height: 260px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f8fafc;">
              Cumulative Taker Delta (Net Aggressive Order Flow)
            </div>
            <div style="font-size: 12px; color: #64748b;">
              Formula: Σ(2 · taker_buy_volume − volume) in BTC
            </div>
          </div>
          <div id="net-delta-stat" style="font-size: 13px; font-weight: 600; color: #38bdf8; font-family: monospace;"></div>
        </div>
        <div id="cum-delta-chart" style="flex: 1; width: 100%; min-height: 200px;"></div>
      </div>

      <!-- Hourly Taker Buy Ratio Bar -->
      <div class="chart-panel" style="background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 14px; flex: 1; display: flex; flex-direction: column; min-height: 240px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f8fafc;">
              Hourly Taker Buy Ratio by Hour of Day (UTC)
            </div>
            <div style="font-size: 12px; color: #64748b;">
              Ratio-of-sums: Σtaker_buy_volume / Σvolume (>0.50 indicates net aggressive buying)
            </div>
          </div>
        </div>
        <div id="hourly-flow-chart" style="flex: 1; width: 100%; min-height: 190px;"></div>
      </div>
    </div>
  `;

  const cumChartEl = container.querySelector('#cum-delta-chart') as HTMLElement;
  const hourlyChartEl = container.querySelector('#hourly-flow-chart') as HTMLElement;
  const netDeltaLabel = container.querySelector('#net-delta-stat') as HTMLElement;

  const cumChart = echarts.init(cumChartEl, 'dark');
  const hourlyChart = echarts.init(hourlyChartEl, 'dark');

  function renderCharts() {
    // 1. Cumulative Taker Delta
    const deltaPoints = computeCumulativeTakerDelta(currentData);
    const times = deltaPoints.map(p => new Date(p.timeMs).toISOString().replace('.000Z', '').replace('T', ' '));
    const cumVals = deltaPoints.map(p => Math.round(p.cumDelta));

    if (deltaPoints.length > 0) {
      const last = deltaPoints[deltaPoints.length - 1].cumDelta;
      netDeltaLabel.textContent = `Net: ${last >= 0 ? '+' : ''}${last.toLocaleString(undefined, { maximumFractionDigits: 0 })} BTC`;
      netDeltaLabel.style.color = last >= 0 ? '#10b981' : '#ef4444';
    }

    cumChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
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
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: 'BTC',
        nameTextStyle: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          formatter: (v: number) => `${(v / 1000).toFixed(0)}k`,
        },
      },
      series: [
        {
          type: 'line',
          data: cumVals,
          showSymbol: false,
          lineStyle: { color: '#38bdf8', width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(56, 189, 248, 0.25)' },
              { offset: 1, color: 'rgba(56, 189, 248, 0.0)' },
            ]),
          },
        },
      ],
    });

    // 2. Hourly Taker Buy Ratio
    const hourlyData = computeSeasonality(currentData, 'hour', 'taker_buy_ratio');
    const hourLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);
    const ratios = hourlyData.map(d => Number((d.value * 100).toFixed(2))); // in %

    hourlyChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const idx = params[0].dataIndex;
          const val = ratios[idx];
          const n = hourlyData[idx].n;
          return `
            <div>Hour ${hourLabels[idx]} UTC</div>
            <div>Taker Buy Ratio: <strong>${val.toFixed(2)}%</strong></div>
            <div style="color: #94a3b8; font-size: 11px;">Sample size n: ${n.toLocaleString()}</div>
          `;
        },
      },
      grid: { left: 55, right: 20, top: 20, bottom: 25 },
      xAxis: {
        type: 'category',
        data: hourLabels,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        min: 45,
        max: 55,
        name: '%',
        nameTextStyle: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
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
            data: [{ yAxis: 50.0, lineStyle: { color: '#94a3b8', type: 'dashed' } }],
          },
        },
      ],
    });
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
    destroy() {
      ro.disconnect();
      cumChart.dispose();
      hourlyChart.dispose();
    },
  };
}
