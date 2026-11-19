/**
 * Calendar & Risk Component.
 * Visualizes:
 * - Year x Month return matrix (monthly returns table / heatmap)
 * - Historical Drawdown Area Chart (peak to trough from close prices)
 */

import * as echarts from 'echarts';
import type { KlineRow } from '../types';
import { computeDrawdownSeries, computeMonthlyReturns } from '../stats/analytics';

export interface CalendarViewInstance {
  updateData(data: KlineRow[]): void;
  destroy(): void;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function createCalendarView(
  container: HTMLElement,
  initialData: KlineRow[]
): CalendarViewInstance {
  let currentData = initialData;

  container.innerHTML = `
    <div class="calendar-view" style="display: flex; flex-direction: column; gap: 16px; height: 100%;">
      <!-- Monthly Returns Grid -->
      <div class="chart-panel" style="background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 14px;">
        <div style="font-size: 14px; font-weight: 600; color: #f8fafc; margin-bottom: 12px;">
          Monthly Return Matrix (Year × Month)
        </div>
        <div id="monthly-matrix-container" style="overflow-x: auto;"></div>
      </div>

      <!-- Drawdown Chart -->
      <div class="chart-panel" style="background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 14px; flex: 1; display: flex; flex-direction: column; min-height: 260px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f8fafc;">
              Historical Underwater / Drawdown Chart
            </div>
            <div style="font-size: 12px; color: #64748b;">
              Calculated from high-water mark close prices
            </div>
          </div>
          <div id="max-dd-stat" style="font-size: 13px; font-weight: 600; color: #ef4444; font-family: monospace;"></div>
        </div>
        <div id="drawdown-chart" style="flex: 1; width: 100%; min-height: 200px;"></div>
      </div>
    </div>
  `;

  const matrixContainer = container.querySelector('#monthly-matrix-container') as HTMLElement;
  const ddChartEl = container.querySelector('#drawdown-chart') as HTMLElement;
  const maxDdLabel = container.querySelector('#max-dd-stat') as HTMLElement;

  const ddChart = echarts.init(ddChartEl, 'dark');

  function renderMatrix() {
    const monthly = computeMonthlyReturns(currentData);
    if (monthly.length === 0) {
      matrixContainer.innerHTML = '<div style="color: #64748b;">No data</div>';
      return;
    }

    // Find all distinct years
    const years = Array.from(new Set(monthly.map(m => m.year))).sort((a, b) => a - b);
    const lookup = new Map<string, number>();
    for (const m of monthly) {
      lookup.set(`${m.year}-${m.month}`, m.returnPct);
    }

    let html = `
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: center; font-family: monospace;">
        <thead>
          <tr style="border-bottom: 1px solid #334155; color: #94a3b8;">
            <th style="padding: 6px; text-align: left;">Year</th>
            ${MONTH_NAMES.map(m => `<th style="padding: 6px;">${m}</th>`).join('')}
            <th style="padding: 6px; border-left: 1px solid #334155; color: #cbd5e1;">YTD</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const y of years) {
      let ytdProduct = 1;
      let hasData = false;

      let rowHtml = `<tr style="border-bottom: 1px solid #1e293b;">
        <td style="padding: 6px; text-align: left; font-weight: 600; color: #cbd5e1;">${y}</td>`;

      for (let m = 0; m < 12; m++) {
        const key = `${y}-${m}`;
        if (lookup.has(key)) {
          hasData = true;
          const ret = lookup.get(key)!;
          ytdProduct *= 1 + ret / 100;
          const bg = ret >= 0 ? `rgba(16, 185, 129, ${Math.min(Math.abs(ret) / 30, 0.7)})` : `rgba(239, 68, 68, ${Math.min(Math.abs(ret) / 30, 0.7)})`;
          const textColor = '#f8fafc';
          rowHtml += `<td style="padding: 6px; background: ${bg}; color: ${textColor};">${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%</td>`;
        } else {
          rowHtml += `<td style="padding: 6px; color: #475569;">—</td>`;
        }
      }

      const ytdPct = hasData ? (ytdProduct - 1) * 100 : 0;
      const ytdBg = ytdPct >= 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
      const ytdColor = ytdPct >= 0 ? '#10b981' : '#ef4444';
      rowHtml += `<td style="padding: 6px; font-weight: 700; border-left: 1px solid #334155; background: ${ytdBg}; color: ${ytdColor};">${hasData ? `${ytdPct >= 0 ? '+' : ''}${ytdPct.toFixed(1)}%` : '—'}</td></tr>`;
      html += rowHtml;
    }

    html += '</tbody></table>';
    matrixContainer.innerHTML = html;
  }

  function renderDrawdown() {
    const { series, maxDrawdownPct } = computeDrawdownSeries(currentData);
    maxDdLabel.textContent = `Max Drawdown: ${maxDrawdownPct.toFixed(2)}%`;

    const times = series.map(p => new Date(p.timeMs).toISOString().substring(0, 10));
    const vals = series.map(p => Number(p.drawdownPct.toFixed(2)));

    ddChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const idx = params[0].dataIndex;
          const p = series[idx];
          return `
            <div>${times[idx]}</div>
            <div>Close: <strong>$${p.close.toLocaleString()}</strong></div>
            <div>High-Water Peak: <strong>$${p.peak.toLocaleString()}</strong></div>
            <div>Drawdown: <strong style="color: #ef4444;">${p.drawdownPct.toFixed(2)}%</strong></div>
          `;
        },
      },
      grid: { left: 55, right: 20, top: 15, bottom: 25 },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        max: 0,
        name: '%',
        nameTextStyle: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      series: [
        {
          type: 'line',
          data: vals,
          showSymbol: false,
          lineStyle: { color: '#ef4444', width: 1.5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(239, 68, 68, 0.45)' },
              { offset: 1, color: 'rgba(239, 68, 68, 0.05)' },
            ]),
          },
        },
      ],
    });
  }

  const ro = new ResizeObserver(() => ddChart.resize());
  ro.observe(container);

  renderMatrix();
  renderDrawdown();

  return {
    updateData(data: KlineRow[]) {
      currentData = data;
      renderMatrix();
      renderDrawdown();
    },
    destroy() {
      ro.disconnect();
      ddChart.dispose();
    },
  };
}
