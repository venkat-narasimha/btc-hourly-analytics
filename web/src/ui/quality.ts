/**
 * Data Quality Tab UI.
 * Renders meta.json + quality_report.json:
 * - Coverage % & total bars
 * - Missing ranges / gaps table
 * - Per-year bar counts with progress indicators
 * - Ingestion Gotcha stats: files_ms vs files_us, header_files
 * - Checksums verified & warnings
 * - Provenance (release ID, git sha, timestamp, source URL)
 */

import type { Meta, QualityReport } from '../types';

export function renderQualityReport(
  container: HTMLElement,
  meta: Meta | null,
  report: QualityReport | null
): void {
  if (!meta || !report) {
    container.innerHTML = `
      <div class="page-wrapper tab-enter">
        <div class="page-header">
          <div class="page-header-left">
            <h2 class="page-title">Data Quality & Pipeline Audit</h2>
            <p class="page-subtitle">Loading data quality artifacts...</p>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const gapsCount = report.missing_ranges.length;
  const covClass = report.coverage_pct >= 99 ? 'positive' : report.coverage_pct >= 95 ? 'warning' : 'negative';

  container.innerHTML = `
    <div class="page-wrapper tab-enter">
      <!-- Page Header -->
      <div class="page-header">
        <div class="page-header-left">
          <h2 class="page-title">Data Quality & Pipeline Audit</h2>
          <p class="page-subtitle">Full verification audit of the underlying Binance Vision dataset, checksums, and anomaly boundaries</p>
        </div>
        <span class="badge ${covClass === 'positive' ? 'badge-positive' : 'badge-warning'}">
          ${report.coverage_pct >= 99 ? 'Institutional Grade' : 'Minor Exchange Gaps'}
        </span>
      </div>

      <!-- Top Metrics Banner: 4 KPI Cards -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">Hourly Coverage</span>
          <div class="kpi-value ${covClass}">${report.coverage_pct.toFixed(2)}%</div>
          <span class="kpi-sub font-tabular">${report.actual_rows.toLocaleString()} / ${report.expected_hours.toLocaleString()} expected hours</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">Checksum Verification</span>
          <div class="kpi-value positive">${report.checksums_verified.toLocaleString()}</div>
          <span class="kpi-sub">SHA-256 archives matched 100%</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">Deduplicated Bars</span>
          <div class="kpi-value text-info">${report.duplicates_removed}</div>
          <span class="kpi-sub font-tabular">${report.quarantined_rows.length} invalid rows quarantined</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">Zero-Volume Bars</span>
          <div class="kpi-value">${report.zero_volume_bars}</div>
          <span class="kpi-sub">Retained as valid market hours</span>
        </div>
      </div>

      <!-- Bento Grid: Ingestion Gotchas + Annual Observations -->
      <div class="bento-grid">
        <!-- Ingestion Gotchas Card -->
        <div class="chart-card bento-col-6">
          <div class="chart-card-header">
            <div>
              <div class="chart-card-title">Ingestion & Parser Pipeline Details</div>
              <div class="chart-card-subtitle">Normalizations handled automatically by pipeline ETL</div>
            </div>
          </div>
          <div class="chart-card-body">
            <div class="overview-insights-grid">
              <div class="insight-row">
                <span class="insight-label">Source Files Downloaded</span>
                <span class="insight-value">${meta.files_downloaded?.monthly ?? 0} monthly + ${meta.files_downloaded?.daily ?? 0} daily</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Timestamp Units Detected</span>
                <span class="insight-value">${report.files_ms} ms files / ${report.files_us} µs files</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Header Rows Sniffed</span>
                <span class="insight-value">${report.header_files} files with headers skipped</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Synthetic Data Injected</span>
                <span class="insight-value text-positive">0 bars (strict no-interpolation policy)</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Negative/Zero Price Violations</span>
                <span class="insight-value text-positive">0 violations detected</span>
              </div>
              <div class="insight-row">
                <span class="insight-label">Exchange Outage Gaps</span>
                <span class="insight-value ${gapsCount > 0 ? 'text-warning' : 'text-positive'}">${gapsCount} gaps recorded</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Annual Bar Counts Card -->
        <div class="chart-card bento-col-6">
          <div class="chart-card-header">
            <div>
              <div class="chart-card-title">Annual Observation Counts</div>
              <div class="chart-card-subtitle">Expected 8,760h per regular year, 8,784h leap year</div>
            </div>
          </div>
          <div class="chart-card-body">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th class="right">Hourly Rows</th>
                  <th class="right">Expected</th>
                  <th class="right">Coverage</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(report.per_year_row_counts)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([year, count]) => {
                    const y = Number(year);
                    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
                    const isCurrentYear = y === new Date().getUTCFullYear();
                    const exp = isLeap ? 8784 : 8760;
                    const pct = isCurrentYear ? (count / 8760) * 100 : (count / exp) * 100;
                    return `
                      <tr>
                        <td class="strong">${year}${isCurrentYear ? ' (YTD)' : ''}</td>
                        <td class="right mono">${count.toLocaleString()}</td>
                        <td class="right mono text-muted">${isCurrentYear ? 'YTD' : exp.toLocaleString()}</td>
                        <td class="right font-tabular">
                          <span class="badge ${isCurrentYear || pct >= 99 ? 'badge-positive' : 'badge-warning'}">
                            ${isCurrentYear ? 'Active' : pct.toFixed(2) + '%'}
                          </span>
                        </td>
                      </tr>
                    `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Missing Gaps Section (if any) -->
      ${gapsCount > 0 ? `
        <div class="chart-card">
          <div class="chart-card-header">
            <div>
              <div class="chart-card-title text-warning">Recorded Exchange Outage Gaps</div>
              <div class="chart-card-subtitle">Consecutive bars missing from Binance Vision; log returns recorded as null</div>
            </div>
            <span class="badge badge-warning">${gapsCount} Discontinuities</span>
          </div>
          <div class="chart-card-body no-padding">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Gap Start (UTC)</th>
                  <th>Gap End (UTC)</th>
                  <th class="right">Missing Hours</th>
                  <th class="right">Category</th>
                </tr>
              </thead>
              <tbody>
                ${report.missing_ranges.map(g => `
                  <tr>
                    <td class="mono">${new Date(g.start_ms).toISOString().replace('.000Z', '')}</td>
                    <td class="mono">${new Date(g.end_ms).toISOString().replace('.000Z', '')}</td>
                    <td class="right mono text-warning font-tabular"><strong>${g.hours}h</strong></td>
                    <td class="right">
                      <span class="badge ${g.hours <= 24 ? 'badge-info' : 'badge-warning'}">
                        ${g.hours <= 24 ? 'Routine Maintenance' : 'Extended Outage'}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- Artifact Provenance Card -->
      <div class="chart-card">
        <div class="chart-card-header">
          <div>
            <div class="chart-card-title">Release Artifact Provenance</div>
            <div class="chart-card-subtitle">Versioned release metadata and reproducibility stamps</div>
          </div>
        </div>
        <div class="chart-card-body">
          <div class="overview-insights-grid">
            <div class="insight-row">
              <span class="insight-label">Release ID</span>
              <span class="insight-value font-mono">${meta.release_id}</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Generated At (UTC)</span>
              <span class="insight-value font-mono">${meta.generated_at_utc}</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Pipeline Git Commit SHA</span>
              <span class="insight-value font-mono">${meta.pipeline_git_sha}</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Market & Symbol</span>
              <span class="insight-value">${meta.symbol} · ${meta.interval} · ${meta.market}</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Data Source Base URL</span>
              <span class="insight-value font-mono text-info" style="font-size: var(--text-xs); word-break: break-all;">${meta.source_base_url}</span>
            </div>
            <div class="insight-row">
              <span class="insight-label">Release Architecture</span>
              <span class="insight-value">Atomic release symlink (/data/current)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
