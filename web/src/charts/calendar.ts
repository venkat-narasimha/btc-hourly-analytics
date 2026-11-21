/**
 * Calendar & Risk Component.
 * Visualizes:
 * - Year x Month return matrix (monthly returns table / heatmap)
 * - Historical Drawdown Area Chart (peak to trough from close prices)
 * - Supports dynamic light and dark theme switching
 */

import * as echarts from 'echarts';
import type { KlineRow, Theme } from '../types';
import { computeDrawdownSeries, computeMonthlyReturns } from '../stats/analytics';
import { getChartTheme } from '../ui/theme';
import { renderInfoTooltip, renderInspectTrigger } from '../ui/tooltip';

export interface CalendarViewInstance {
  updateData(data: KlineRow[]): void;
  setTheme(theme: Theme): void;
  destroy(): void;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function createCalendarView(
  container: HTMLElement,
  initialData: KlineRow[],
  initialTheme: Theme = 'light'
): CalendarViewInstance {
  let currentData = initialData;
  let currentTheme: Theme = initialTheme;

  container.innerHTML = `
    <div class="page-wrapper tab-enter calendar-view" style="display: flex; flex-direction: column; gap: 16px; height: 100%;">
      <!-- Monthly Returns Grid -->
      <div class="card chart-card">
        <div class="hd chart-card-header">
          <div>
            <h3 class="chart-card-title" style="margin: 0; display: flex; align-items: center; gap: 6px;">
              <span>Monthly Return Matrix (Year × Month)</span>
              ${renderInfoTooltip({
                defId: 'calendar.monthly_returns',
                title: 'Monthly Return Matrix & YTD Compounding',
                description: 'Percentage price performance grouped by calendar month, with discrete geometrically compounded Year-to-Date (YTD) returns. Click any cell to inspect.',
                caveat: 'Calendar months vary between 28 and 31 days (672 to 744 hourly bars). YTD uses exact discrete compounding.',
                position: 'bottom',
              })}
              ${renderInspectTrigger('calendar.monthly_returns', { title: 'Inspect Monthly Return Matrix' })}
            </h3>
            <small class="chart-card-subtitle text-muted">open→close · YTD = Π(1+r)−1</small>
          </div>
        </div>
        <div id="monthly-matrix-container" class="bd chart-card-body" style="overflow-x: auto;"></div>
      </div>

      <!-- Drawdown Chart -->
      <div class="card chart-card" style="flex: 1; display: flex; flex-direction: column; min-height: 260px;">
        <div class="hd chart-card-header">
          <div>
            <h3 class="chart-card-title" style="margin: 0; display: flex; align-items: center; gap: 6px;">
              <span>Underwater / Drawdown</span>
              ${renderInfoTooltip({
                defId: 'calendar.drawdown_series',
                title: 'High-Water Mark Drawdown Series',
                description: 'Measures continuous loss relative to the highest peak close price recorded up to each hourly bar.',
                caveat: 'Measured on hourly bar closes. Sub-hourly flash crashes (e.g. March 2020) were deeper on intra-candle wick lows.',
                position: 'bottom',
              })}
              ${renderInspectTrigger('calendar.drawdown_series', { title: 'Inspect Drawdown Series' })}
            </h3>
            <small class="chart-card-subtitle text-muted">close vs running high-water mark</small>
          </div>
          <span id="max-dd-stat" class="sp badge red" style="margin-left: auto;"></span>
        </div>
        <div id="drawdown-chart" class="bd chart-card-body no-padding" style="flex: 1; width: 100%; min-height: 200px;"></div>
      </div>
    </div>
  `;

  const matrixContainer = container.querySelector('#monthly-matrix-container') as HTMLElement;
  const ddChartEl = container.querySelector('#drawdown-chart') as HTMLElement;
  const maxDdLabel = container.querySelector('#max-dd-stat') as HTMLElement;

  const ddChart = echarts.init(ddChartEl);

  function renderMatrix() {
    const monthly = computeMonthlyReturns(currentData);
    if (monthly.length === 0) {
      matrixContainer.innerHTML = '<div style="color: var(--text-muted);">No data</div>';
      return;
    }

    // Find all distinct years
    const years = Array.from(new Set(monthly.map(m => m.year))).sort((a, b) => a - b);
    const lookup = new Map<string, number>();
    for (const m of monthly) {
      lookup.set(`${m.year}-${m.month}`, m.returnPct);
    }

    let html = `
      <table class="cal data-table" style="width: 100%;">
        <thead>
          <tr>
            <th style="padding: 6px; text-align: left;">Year</th>
            ${MONTH_NAMES.map(m => `<th style="padding: 6px;">${m}</th>`).join('')}
            <th style="padding: 6px;">YTD</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const y of years) {
      let ytdProduct = 1;
      let hasData = false;

      let rowHtml = `<tr>
        <td style="padding: 6px 8px; text-align: left; font-weight: 800; color: var(--ink);">${y}</td>`;

      for (let m = 0; m < 12; m++) {
        const key = `${y}-${m}`;
        if (lookup.has(key)) {
          hasData = true;
          const ret = lookup.get(key)!;
          ytdProduct *= 1 + ret / 100;
          const a = Math.min(Math.abs(ret) / 30, 0.72);
          const bg = ret >= 0
            ? `rgba(14, 159, 110, ${a})`
            : `rgba(224, 36, 36, ${a})`;
          const textColor = a > 0.4 ? '#ffffff' : 'var(--ink)';
          rowHtml += `<td class="calendar-month-cell" data-inspect-def="calendar.monthly_returns" data-inspect-target="${y}-${String(m + 1).padStart(2, '0')}" style="background: ${bg}; color: ${textColor};" title="Inspect ${MONTH_NAMES[m]} ${y}">${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%</td>`;
        } else {
          rowHtml += `<td class="na" style="color: var(--muted);">—</td>`;
        }
      }

      const ytdPct = hasData ? (ytdProduct - 1) * 100 : 0;
      const ytdColor = ytdPct >= 0 ? 'var(--green)' : 'var(--red)';
      rowHtml += `<td class="ytd calendar-ytd-cell" data-inspect-def="calendar.ytd" data-inspect-target="${y}" style="color: ${ytdColor};" title="Inspect ${y} YTD">${hasData ? `${ytdPct >= 0 ? '+' : ''}${ytdPct.toFixed(1)}%` : '—'}</td></tr>`;
      html += rowHtml;
    }

    html += '</tbody></table>';
    matrixContainer.innerHTML = html;
  }

  function renderDrawdown() {
    const colors = getChartTheme(currentTheme);
    const { series, maxDrawdownPct } = computeDrawdownSeries(currentData);
    maxDdLabel.textContent = `Max ${maxDrawdownPct >= 0 ? '+' : ''}${maxDrawdownPct.toFixed(2)}%`;

    const times = series.map(p => new Date(p.timeMs).toISOString().substring(0, 10));
    const vals = series.map(p => Number(p.drawdownPct.toFixed(2)));

    ddChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        formatter: (params: any) => {
          const idx = params[0].dataIndex;
          const p = series[idx];
          const d = new Date(p.timeMs);
          const dtStr = `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;
          return `
            <div>${dtStr}</div>
            <div>Close: <strong>$${p.close.toLocaleString()}</strong></div>
            <div>High-Water Peak: <strong>$${p.peak.toLocaleString()}</strong></div>
            <div>Drawdown: <strong style="color: var(--color-negative);">${p.drawdownPct.toFixed(2)}%</strong></div>
          `;
        },
      },
      grid: { left: 55, right: 20, top: 15, bottom: 25 },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        max: 0,
        name: '%',
        nameTextStyle: { color: colors.textSecondary },
        splitLine: { lineStyle: { color: colors.gridLineColor } },
        axisLabel: { color: colors.textSecondary, fontSize: 11 },
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
    }, true);
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
    setTheme(th: Theme) {
      currentTheme = th;
      renderMatrix();
      renderDrawdown();
    },
    destroy() {
      ro.disconnect();
      ddChart.dispose();
    },
  };
}
