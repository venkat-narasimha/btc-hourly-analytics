/**
 * Price Chart component using TradingView Lightweight Charts v5.
 * Features:
 * - Candlestick series
 * - Volume histogram series on second pane (v5 multi-pane API)
 * - Log-scale toggle
 * - UTC ↔ IST toggle (+19,800s to display timestamp, axis label)
 * - Light ↔ Dark theme dynamic styling
 * - Crosshair OHLCV tooltip
 * - Responsive auto-resize
 */

import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  PriceScaleMode,
  CrosshairMode,
  type IChartApi,
  type Time,
  type UTCTimestamp,
  type CandlestickData,
  type HistogramData,
  type MouseEventParams,
} from 'lightweight-charts';
import type { KlineRow, Theme } from '../types';
import { getChartTheme } from '../ui/theme';

export interface PriceChartInstance {
  updateData(data: KlineRow[], isIst: boolean): void;
  setLogScale(enabled: boolean): void;
  setTheme(theme: Theme): void;
  destroy(): void;
  resize(width: number, height: number): void;
}

export function createPriceChart(
  container: HTMLElement,
  initialData: KlineRow[],
  isIst = false,
  isLogScale = false,
  initialTheme: Theme = 'light'
): PriceChartInstance {
  let currentTheme = initialTheme;
  let colors = getChartTheme(currentTheme);

  // Chart container layout
  container.innerHTML = `
    <div class="page-wrapper tab-enter price-chart-wrapper" style="position: relative; width: 100%; height: 100%; display: flex; flex-direction: column;">
      <div class="chart-card-header price-chart-toolbar" style="display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border);">
        <label class="toggle-control" style="font-size: var(--text-sm); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; gap: 6px;">
          <input type="checkbox" id="log-scale-checkbox" ${isLogScale ? 'checked' : ''} />
          <span>Log Scale</span>
        </label>
        <span class="timezone-indicator" style="font-size: var(--text-xs); color: var(--color-info); margin-left: auto;">
          Time axis: <strong id="tz-axis-label" style="color: var(--text-primary);">${isIst ? 'IST (UTC+5:30)' : 'UTC'}</strong>
        </span>
      </div>
      <div class="price-chart-container" style="width: 100%; height: calc(100% - 44px); position: relative; border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--border); background: var(--chart-bg);"></div>
      <div class="price-chart-tooltip" style="position: absolute; top: 48px; left: 16px; z-index: 10; pointer-events: none; font-size: var(--text-xs); padding: 6px 10px; border-radius: var(--radius-sm); font-family: var(--font-mono, monospace); display: none;"></div>
    </div>
  `;

  const chartEl = container.querySelector('.price-chart-container') as HTMLElement;
  const tooltipEl = container.querySelector('.price-chart-tooltip') as HTMLElement;
  const logCheckbox = container.querySelector('#log-scale-checkbox') as HTMLInputElement;
  const tzLabel = container.querySelector('#tz-axis-label') as HTMLElement;

  function applyTooltipTheme() {
    tooltipEl.style.color = colors.tooltipText;
    tooltipEl.style.backgroundColor = colors.tooltipBg;
    tooltipEl.style.border = `1px solid ${colors.tooltipBorder}`;
    tooltipEl.style.boxShadow = currentTheme === 'light' ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none';
  }
  applyTooltipTheme();

  const chart: IChartApi = createChart(chartEl, {
    width: chartEl.clientWidth || 800,
    height: chartEl.clientHeight || 500,
    layout: {
      background: { color: colors.background },
      textColor: colors.textSecondary,
      fontSize: 12,
    },
    grid: {
      vertLines: { color: colors.gridLineColor },
      horzLines: { color: colors.gridLineColor },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: colors.textSecondary, width: 1, style: 3 },
      horzLine: { color: colors.textSecondary, width: 1, style: 3 },
    },
    rightPriceScale: {
      borderColor: colors.borderColor,
      mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    },
    timeScale: {
      borderColor: colors.borderColor,
      timeVisible: true,
      secondsVisible: false,
    },
  });

  // Candlestick series on Pane 0
  const candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: colors.candleUp,
    downColor: colors.candleDown,
    borderUpColor: colors.candleUp,
    borderDownColor: colors.candleDown,
    wickUpColor: colors.candleUp,
    wickDownColor: colors.candleDown,
  }, 0);

  // Volume histogram on Pane 1
  const volumeSeries = chart.addSeries(HistogramSeries, {
    color: colors.volumeBar,
    priceFormat: { type: 'volume' },
  }, 1);

  // Set pane heights if panes API available
  try {
    const panes = chart.panes();
    if (panes && panes.length >= 2) {
      panes[0].setHeight(chartEl.clientHeight * 0.75);
      panes[1].setHeight(chartEl.clientHeight * 0.25);
    }
  } catch {
    // Ignore pane sizing error fallback
  }

  // Convert KlineRow[] to chart data
  function formatData(data: KlineRow[], ist: boolean) {
    const offsetSec = ist ? 19800 : 0; // 5 hours 30 min in seconds
    const candles: CandlestickData<UTCTimestamp>[] = [];
    const volumes: HistogramData<UTCTimestamp>[] = [];

    for (const r of data) {
      const timeSec = Math.floor(r.open_time_ms / 1000) + offsetSec;
      const t = timeSec as UTCTimestamp;
      candles.push({
        time: t,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
      });
      const isUp = r.close >= r.open;
      volumes.push({
        time: t,
        value: r.volume,
        color: isUp ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)',
      });
    }

    return { candles, volumes };
  }

  // Populate initial data
  const { candles, volumes } = formatData(initialData, isIst);
  candleSeries.setData(candles);
  volumeSeries.setData(volumes);

  // Tooltip crosshair subscriber
  chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
    if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
      tooltipEl.style.display = 'none';
      return;
    }

    const candle = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
    const vol = param.seriesData.get(volumeSeries) as HistogramData<Time> | undefined;

    if (!candle) {
      tooltipEl.style.display = 'none';
      return;
    }

    const date = new Date(Number(param.time) * 1000);
    const dateStr = date.toISOString().replace('.000Z', '').replace('T', ' ');

    tooltipEl.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 2px;">${dateStr} (${isIst ? 'IST' : 'UTC'})</div>
      <div>O: <span style="font-weight:600">${candle.open.toFixed(2)}</span>  H: <span style="font-weight:600">${candle.high.toFixed(2)}</span></div>
      <div>L: <span style="font-weight:600">${candle.low.toFixed(2)}</span>  C: <span style="font-weight:600">${candle.close.toFixed(2)}</span></div>
      ${vol ? `<div>Vol: <span style="color:${colors.volumeBar}">${vol.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} BTC</span></div>` : ''}
    `;
    tooltipEl.style.display = 'block';
  });

  // Log scale toggle
  logCheckbox.addEventListener('change', () => {
    const isLog = logCheckbox.checked;
    chart.priceScale('right', 0).applyOptions({
      mode: isLog ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  });

  // ResizeObserver for container resizing
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 36) {
        chart.resize(width, height - 36);
        try {
          const panes = chart.panes();
          if (panes && panes.length >= 2) {
            panes[0].setHeight((height - 36) * 0.75);
            panes[1].setHeight((height - 36) * 0.25);
          }
        } catch {
          // ignore
        }
      }
    }
  });
  ro.observe(chartEl);

  function applyChartTheme(th: Theme) {
    currentTheme = th;
    colors = getChartTheme(th);
    applyTooltipTheme();

    chart.applyOptions({
      layout: {
        background: { color: colors.background },
        textColor: colors.textSecondary,
      },
      grid: {
        vertLines: { color: colors.gridLineColor },
        horzLines: { color: colors.gridLineColor },
      },
      rightPriceScale: {
        borderColor: colors.borderColor,
      },
      timeScale: {
        borderColor: colors.borderColor,
      },
    });

    candleSeries.applyOptions({
      upColor: colors.candleUp,
      downColor: colors.candleDown,
      borderUpColor: colors.candleUp,
      borderDownColor: colors.candleDown,
      wickUpColor: colors.candleUp,
      wickDownColor: colors.candleDown,
    });
    volumeSeries.applyOptions({
      color: colors.volumeBar,
    });
  }

  return {
    updateData(data: KlineRow[], ist: boolean) {
      isIst = ist;
      tzLabel.textContent = ist ? 'IST (UTC+5:30)' : 'UTC';
      const formatted = formatData(data, ist);
      candleSeries.setData(formatted.candles);
      volumeSeries.setData(formatted.volumes);
    },
    setLogScale(enabled: boolean) {
      logCheckbox.checked = enabled;
      chart.priceScale('right', 0).applyOptions({
        mode: enabled ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      });
    },
    setTheme(th: Theme) {
      applyChartTheme(th);
    },
    resize(width: number, height: number) {
      chart.resize(width, height);
    },
    destroy() {
      ro.disconnect();
      chart.remove();
    },
  };
}
