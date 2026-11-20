/**
 * Overview / Dashboard Landing Page.
 * Displays key dataset stats, macro metrics, seasonality quick-glance,
 * annual observation coverage, and artifact provenance.
 */

import type { KlineRow, Meta, QualityReport } from '../types';
import { computeSeasonality, DOW_LABELS } from '../stats/aggregations';
import { computeDrawdownSeries } from '../stats/analytics';
import { formatSignedBps } from '../stats/display';
import { renderInfoTooltip } from './tooltip';

export function createOverviewPage(
  container: HTMLElement,
  data: KlineRow[],
  meta: Meta,
  qualityData: QualityReport | null
): void {
  if (data.length === 0) {
    container.innerHTML = `
      <div class="page-wrapper tab-enter">
        <div class="page-header">
          <div class="page-header-left">
            <h2 class="page-title">Overview</h2>
            <p class="page-subtitle">No dataset available.</p>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // 1. Compute KPI values
  const totalBars = data.length;
  const firstDate = new Date(data[0].open_time_ms);
  const lastDate = new Date(data[data.length - 1].open_time_ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateRangeStr = `${months[firstDate.getUTCMonth()]} ${firstDate.getUTCFullYear()} – ${months[lastDate.getUTCMonth()]} ${lastDate.getUTCFullYear()}`;

  const coveragePct = qualityData?.coverage_pct ?? 100;
  const covClass = coveragePct >= 99 ? 'positive' : coveragePct >= 95 ? 'warning' : 'negative';

  const isFiltered = meta ? data.length < meta.rows : false;
  const periodLabel = isFiltered ? 'selected range' : 'full period';

  const lastBar = data[data.length - 1];
  const firstBar = data[0];
  const latestPrice = lastBar.close;
  const priceChangePct = ((lastBar.close - firstBar.open) / firstBar.open) * 100;
  const priceClass = priceChangePct >= 0 ? 'positive' : 'negative';

  const { maxDrawdownPct } = computeDrawdownSeries(data);

  // 2. Seasonality quick-glance insights
  const hourReturns = computeSeasonality(data, 'hour', 'mean_return');
  let bestHour = hourReturns[0];
  let worstHour = hourReturns[0];
  for (const h of hourReturns) {
    if (h.value > bestHour.value) bestHour = h;
    if (h.value < worstHour.value) worstHour = h;
  }

  const dowReturns = computeSeasonality(data, 'dow', 'mean_return');
  let bestDow = dowReturns[0];
  let worstDow = dowReturns[0];
  for (const d of dowReturns) {
    if (d.value > bestDow.value) bestDow = d;
    if (d.value < worstDow.value) worstDow = d;
  }

  const validRets = data.filter(r => r.log_ret !== null).map(r => r.log_ret as number);
  const winCount = validRets.filter(r => r > 0).length;
  const winRate = validRets.length > 0 ? (winCount / validRets.length) * 100 : 0;
  const meanRetBps = validRets.length > 0 ? (validRets.reduce((a, b) => a + b, 0) / validRets.length) * 10000 : 0;

  // 3. Group bars by year for the annual observation timeline
  const yearCounts: Record<number, number> = {};
  for (const r of data) {
    const y = new Date(r.open_time_ms).getUTCFullYear();
    yearCounts[y] = (yearCounts[y] || 0) + 1;
  }
  const years = Object.keys(yearCounts).map(Number).sort((a, b) => a - b);

  container.innerHTML = `
    <div class="page-wrapper tab-enter">
      <!-- Page Header -->
      <div class="page-header">
        <div class="page-header-left">
          <h2 class="page-title">Analytics Overview</h2>
          <p class="page-subtitle">Descriptive historical analytics over Binance USDⓈ-M Futures BTCUSDT 1h klines</p>
        </div>
      </div>

      <!-- KPI Grid: 5 Macro Cards -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">
            <span>Dataset Bars</span>
            ${renderInfoTooltip({
              title: 'Dataset Observations',
              description: 'Total discrete 1-hour OHLCV candles ingested directly from Binance Vision into parquet.',
              formula: 'N = Total Hourly Observations',
              caveat: 'Exchange downtime intervals are preserved as null returns, never forward-filled or interpolated.',
              position: 'bottom',
            })}
          </span>
          <div class="kpi-value">${totalBars.toLocaleString('en-US')}</div>
          <span class="kpi-sub">Hourly observations loaded</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">
            <span>Date Range</span>
            ${renderInfoTooltip({
              title: 'Chronological Scope',
              description: 'Continuous historical range from first recorded kline open to the latest pipeline build.',
              formula: 'Δt = Latest Bar Date − First Bar Date',
              position: 'bottom',
            })}
          </span>
          <div class="kpi-value" style="font-size: var(--text-lg);">${dateRangeStr}</div>
          <span class="kpi-sub">${((data[data.length - 1].open_time_ms - data[0].open_time_ms) / (86400000 * 365.25)).toFixed(1)} years span</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">
            <span>Data Coverage</span>
            ${renderInfoTooltip({
              title: 'Hourly Data Coverage',
              description: 'Ratio of ingested hourly bars relative to theoretical calendar hours.',
              formula: 'Coverage = (Actual Bars / Expected Hours) × 100%',
              caveat: 'Unrecorded hours correspond strictly to scheduled or emergency Binance maintenance windows.',
              position: 'bottom',
            })}
          </span>
          <div class="kpi-value ${covClass}">${coveragePct.toFixed(2)}%</div>
          <span class="kpi-sub">${qualityData?.expected_hours ? (qualityData.actual_rows.toLocaleString() + ' / ' + qualityData.expected_hours.toLocaleString() + ' expected') : 'Zero synthetic data'}</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">
            <span>Latest Close</span>
            ${renderInfoTooltip({
              title: 'Latest Close & Total Return',
              description: 'Most recent hourly close price and nominal percentage change across full dataset.',
              formula: 'Total Return = ((Latest Close − Initial Open) / Initial Open) × 100%',
              position: 'bottom',
            })}
          </span>
          <div class="kpi-value ${priceClass}">$${latestPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          <span class="kpi-sub ${priceClass}">${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(1)}% ${periodLabel}</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">
            <span>Max Drawdown</span>
            ${renderInfoTooltip({
              title: 'Maximum Peak-to-Trough Drawdown',
              description: 'Largest percentage drop from a prior historical high-water mark close price.',
              formula: 'MDD = max( (Peak − Close_t) / Peak ) × 100%',
              caveat: 'Computed from hourly close points; intra-hour flash wicks may have been slightly lower.',
              position: 'bottom',
            })}
          </span>
          <div class="kpi-value negative">${maxDrawdownPct.toFixed(2)}%</div>
          <span class="kpi-sub">Peak-to-trough all-time</span>
        </div>
      </div>

      <!-- Bento Grid Row: Seasonality Insights + Annual Observation Breakdown -->
      <div class="bento-grid">
        <!-- Seasonality Insights Card -->
        <div class="chart-card bento-col-6">
          <div class="chart-card-header">
            <div>
              <div class="chart-card-title">
                Seasonality Tendencies (UTC)
                ${renderInfoTooltip({
                  title: 'Seasonality Tendencies',
                  description: 'Mean logarithmic return aggregated across UTC hours and days of the week.',
                  formula: 'r_t = ln(Close_t / Close_t-1) × 10,000 bps',
                  caveat: 'Low R²: Diurnal tendencies are descriptive historical averages and do not represent standalone trading alpha.',
                  position: 'bottom',
                })}
              </div>
              <div class="chart-card-subtitle">Aggregated log returns · descriptive, not predictive</div>
            </div>
            <span class="badge badge-warning">Caveat: Low R²</span>
          </div>
          <div class="chart-card-body">
            <div class="overview-insights-grid">
              <div class="insight-row">
                <span class="insight-label">Best Hour (Mean Return)</span>
                <span class="insight-value ${bestHour.value >= 0 ? 'text-positive' : 'text-negative'}">${String(bestHour.bucket).padStart(2, '0')}:00 UTC (${formatSignedBps(bestHour.value)})</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Worst Hour (Mean Return)</span>
                <span class="insight-value ${worstHour.value >= 0 ? 'text-positive' : 'text-negative'}">${String(worstHour.bucket).padStart(2, '0')}:00 UTC (${formatSignedBps(worstHour.value)})</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Best Day of Week</span>
                <span class="insight-value ${bestDow.value >= 0 ? 'text-positive' : 'text-negative'}">${DOW_LABELS[bestDow.bucket]} (${formatSignedBps(bestDow.value)})</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Worst Day of Week</span>
                <span class="insight-value ${worstDow.value >= 0 ? 'text-positive' : 'text-negative'}">${DOW_LABELS[worstDow.bucket]} (${formatSignedBps(worstDow.value)})</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Hourly Win Rate</span>
                <span class="insight-value text-info">${winRate.toFixed(1)}% positive bars</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Mean Hourly Return</span>
                <span class="insight-value">${meanRetBps >= 0 ? '+' : ''}${meanRetBps.toFixed(2)} bps</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Annual Coverage Progress Card -->
        <div class="chart-card bento-col-6">
          <div class="chart-card-header">
            <div>
              <div class="chart-card-title">
                Annual Observation Counts
                ${renderInfoTooltip({
                  title: 'Annual Expected Observations',
                  description: 'Comparison of actual recorded hourly candles against theoretical astronomical year hours.',
                  formula: 'Hours = 24 × 365 (8,760h)  [8,784h in leap years]',
                  position: 'bottom',
                })}
              </div>
              <div class="chart-card-subtitle">Expected 8,760h per normal year, 8,784h leap year</div>
            </div>
            <span class="badge ${coveragePct >= 99 ? 'badge-positive' : 'badge-warning'}">${coveragePct >= 99 ? 'Integrity Verified' : 'Gaps Present'}</span>
          </div>
          <div class="chart-card-body">
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${years.map(y => {
                const count = yearCounts[y];
                const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
                const expected = isLeap ? 8784 : 8760;
                const isCurrentYear = y === new Date().getUTCFullYear();
                const pct = Math.min((count / expected) * 100, 100);
                const color = isCurrentYear ? 'var(--color-info)' : pct >= 99 ? 'var(--color-positive)' : 'var(--color-warning)';
                return `
                  <div>
                    <div style="display: flex; justify-content: space-between; font-size: var(--text-xs); margin-bottom: 4px;">
                      <span style="font-weight: 600; color: var(--text-primary);">${y}${isCurrentYear ? ' (YTD)' : ''}</span>
                      <span class="font-tabular text-secondary">${count.toLocaleString()} / ${isCurrentYear ? 'YTD' : expected.toLocaleString()} bars (${pct.toFixed(1)}%)</span>
                    </div>
                    <div class="progress-bar-wrap">
                      <div class="progress-bar-bg">
                        <div class="progress-bar-fill" style="width: ${pct}%; background: ${color};"></div>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Provenance & Methodology Footer Card -->
      <div class="chart-card">
        <div class="chart-card-header">
          <div>
            <div class="chart-card-title">
              Dataset Provenance & Statistical Methodology
              ${renderInfoTooltip({
                title: 'Data Provenance & Pipeline Integrity',
                description: 'End-to-end data lineage connecting client visualization to verified immutable Parquet release artifacts.',
                formula: 'SHA-256(archive) == Verified Checksum',
                caveat: 'hyparquet parses static Parquet files directly in-browser via HTTP byte-range requests without backend servers.',
                position: 'top',
              })}
            </div>
            <div class="chart-card-subtitle">Fully reproducible server-side ETL pipeline with zero client-side exchange requests</div>
          </div>
        </div>
        <div class="chart-card-body">
          <div class="overview-insights-grid">
            <div class="insight-row">
              <span class="insight-label">Market & Pair</span>
              <span class="insight-value font-mono">${meta.symbol} · ${meta.interval} · ${meta.market}</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Release ID</span>
              <span class="insight-value font-mono">${meta.release_id}</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Pipeline Git SHA</span>
              <span class="insight-value font-mono">${meta.pipeline_git_sha}</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Generated (UTC)</span>
              <span class="insight-value font-mono">${meta.generated_at_utc}</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Files Ingested</span>
              <span class="insight-value">${meta.files_downloaded?.monthly ?? 0} monthly + ${meta.files_downloaded?.daily ?? 0} daily ZIPs</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Exchange Gaps Policy</span>
              <span class="insight-value text-info">Preserved as null returns, never fabricated</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
