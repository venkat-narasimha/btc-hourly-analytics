/**
 * Price Chart component using TradingView Lightweight Charts v5.
 * Features:
 * - Candlestick series
 * - Volume histogram series on second pane (v5 multi-pane API)
 * - Log-scale toggle
 * - UTC ↔ IST toggle (+19,800s to display timestamp, axis label)
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
import type { KlineRow } from '../types';

export interface PriceChartInstance {
  updateData(data: KlineRow[], isIst: boolean): void;
  setLogScale(enabled: boolean): void;
  destroy(): void;
  resize(width: number, height: number): void;
}

export function createPriceChart(
  container: HTMLElement,
  initialData: KlineRow[],
  isIst = false,
  isLogScale = false
): PriceChartInstance {
  // Chart container layout
  container.innerHTML = `
    <div class="price-chart-wrapper" style="position: relative; width: 100%; height: 100%;">
      <div class="price-chart-toolbar" style="display: flex; gap: 12px; align-items: center; margin-bottom: 8px;">
        <label class="toggle-control" style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: #94a3b8; cursor: pointer;">
          <input type="checkbox" id="log-scale-checkbox" ${isLogScale ? 'checked' : ''} />
          <span>Log Scale</span>
        </label>
        <span class="timezone-indicator" style="font-size: 12px; color: #64748b; margin-left: auto;">
          Time axis: <strong id="tz-axis-label" style="color: #cbd5e1;">${isIst ? 'IST (UTC+5:30)' : 'UTC'}</strong>
        </span>
      </div>
      <div class="price-chart-container" style="width: 100%; height: calc(100% - 36px); position: relative;"></div>
      <div class="price-chart-tooltip" style="position: absolute; top: 44px; left: 16px; z-index: 10; pointer-events: none; font-size: 12px; color: #cbd5e1; background: rgba(15, 23, 42, 0.85); padding: 6px 10px; border-radius: 4px; border: 1px solid #334155; font-family: monospace; display: none;"></div>
    </div>
  `;

  const chartEl = container.querySelector('.price-chart-container') as HTMLElement;
  const tooltipEl = container.querySelector('.price-chart-tooltip') as HTMLElement;
  const logCheckbox = container.querySelector('#log-scale-checkbox') as HTMLInputElement;
  const tzLabel = container.querySelector('#tz-axis-label') as HTMLElement;

  const chart: IChartApi = createChart(chartEl, {
    width: chartEl.clientWidth || 800,
    height: chartEl.clientHeight || 500,
    layout: {
      background: { color: '#090d16' },
      textColor: '#94a3b8',
      fontSize: 12,
    },
    grid: {
      vertLines: { color: '#1e293b' },
      horzLines: { color: '#1e293b' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#475569', width: 1, style: 3 },
      horzLine: { color: '#475569', width: 1, style: 3 },
    },
    rightPriceScale: {
      borderColor: '#334155',
      mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    },
    timeScale: {
      borderColor: '#334155',
      timeVisible: true,
      secondsVisible: false,
    },
  });

  // Candlestick series on Pane 0
  const candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#10b981',
    downColor: '#ef4444',
    borderUpColor: '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
  }, 0);

  // Volume histogram on Pane 1
  const volumeSeries = chart.addSeries(HistogramSeries, {
    color: '#60a5fa',
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
      <div>O: <span style="color:#f8fafc">${candle.open.toFixed(2)}</span>  H: <span style="color:#f8fafc">${candle.high.toFixed(2)}</span></div>
      <div>L: <span style="color:#f8fafc">${candle.low.toFixed(2)}</span>  C: <span style="color:#f8fafc">${candle.close.toFixed(2)}</span></div>
      ${vol ? `<div>Vol: <span style="color:#60a5fa">${vol.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} BTC</span></div>` : ''}
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
    resize(width: number, height: number) {
      chart.resize(width, height);
    },
    destroy() {
      ro.disconnect();
      chart.remove();
    },
  };
}
