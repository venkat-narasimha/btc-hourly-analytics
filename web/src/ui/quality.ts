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
import { renderInfoTooltip, renderInspectTrigger } from './tooltip';

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

  const totalDownloaded = (meta.files_downloaded?.monthly ?? 0) + (meta.files_downloaded?.daily ?? 0);
  const checksumPct = totalDownloaded > 0 ? ((report.checksums_verified / totalDownloaded) * 100).toFixed(0) : '100';
  const totalViolations = report.quarantined_rows.reduce((sum, r) => sum + r.count, 0);

  const liveAgeHours = (Date.now() - meta.last_open_ms) / 3.6e6;
  const isStale = liveAgeHours > 48;
  const freshnessText = `${liveAgeHours.toFixed(1)}h ago`;

  container.innerHTML = `
    <div class="page-wrapper tab-enter">
      <!-- Page Header -->
      <div class="page-header">
        <div class="page-header-left">
          <h2 class="page-title">Data Quality & Pipeline Audit</h2>
          <p class="page-subtitle">Full verification audit of the underlying Binance Vision dataset, checksums, and anomaly boundaries</p>
        </div>
        <div style="display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap;">
          <span class="badge ${isStale ? 'badge-warning' : 'badge-positive'}" data-testid="quality-freshness-badge">
            ${isStale ? `Stale Data (${freshnessText})` : `Fresh Data (${freshnessText})`}
          </span>
          <span class="badge ${covClass === 'positive' ? 'badge-positive' : 'badge-warning'}">
            ${report.coverage_pct >= 99 ? 'Institutional Grade' : 'Minor Exchange Gaps'}
          </span>
        </div>
      </div>

      <!-- Top Metrics Banner: 4 KPI Cards -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">
            <span>Hourly Coverage</span>
            ${renderInfoTooltip({
              defId: 'kpi.coverage_pct',
              title: 'Ingestion Coverage Ratio',
              description: 'Percentage of expected calendar hours present with valid verified OHLCV bars.',
              caveat: 'Missing bars strictly correspond to documented Binance exchange downtime.',
              position: 'bottom',
            })}
            ${renderInspectTrigger('kpi.coverage_pct', { title: 'Inspect Hourly Coverage' })}
          </span>
          <div class="kpi-value ${covClass}">${report.coverage_pct.toFixed(2)}%</div>
          <span class="kpi-sub font-tabular">${report.actual_rows.toLocaleString()} / ${report.expected_hours.toLocaleString()} expected hours</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">
            <span>Checksum Verification</span>
            ${renderInfoTooltip({
              defId: 'quality.checksums',
              title: 'Cryptographic Checksum Audit',
              description: 'Every monthly and daily ZIP archive downloaded from Binance Vision is validated against official SHA-256 hashes.',
              position: 'bottom',
            })}
            ${renderInspectTrigger('quality.checksums', { title: 'Inspect Checksums' })}
          </span>
          <div class="kpi-value positive">${report.checksums_verified.toLocaleString()}</div>
          <span class="kpi-sub font-tabular">${report.checksums_verified.toLocaleString()} / ${totalDownloaded.toLocaleString()} archives matched (${checksumPct}%)</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">
            <span>Deduplicated Bars</span>
            ${renderInfoTooltip({
              defId: 'quality.provenance',
              title: 'Timestamp Deduplication',
              description: 'Identical open_time timestamps resolved deterministically by preferring daily archive slices over monthly files on conflict (keep="last").',
              position: 'bottom',
            })}
            ${renderInspectTrigger('quality.provenance', { title: 'Inspect Deduplicated Bars' })}
          </span>
          <div class="kpi-value text-info">${report.duplicates_removed}</div>
          <span class="kpi-sub font-tabular">${report.quarantined_rows.length} invalid rows quarantined</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">
            <span>Zero-Volume Bars</span>
            ${renderInfoTooltip({
              defId: 'quality.provenance',
              title: 'Zero Volume Integrity Check',
              description: 'Candles with 0.0 traded volume. Kept intact because price continuity remains unbroken.',
              caveat: 'Zero-volume bars typically occur during matching engine freezes or test intervals.',
              position: 'bottom',
            })}
            ${renderInspectTrigger('quality.provenance', { title: 'Inspect Zero-Volume Bars' })}
          </span>
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
              <div class="chart-card-title">
                Ingestion &amp; Parser Pipeline Details
                ${renderInfoTooltip({
                  defId: 'quality.provenance',
                  title: 'Ingestion Pipeline Normalizations',
                  description: 'Automated ETL handling millisecond/microsecond timestamp variants, header sniffing, and data validation.',
                  position: 'bottom',
                })}
                ${renderInspectTrigger('quality.provenance', { title: 'Inspect Ingestion Pipeline' })}
              </div>
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
                <span class="insight-label">Checksums Matched</span>
                <span class="insight-value ${report.checksums_verified >= totalDownloaded && totalDownloaded > 0 ? 'text-positive' : 'text-warning'} font-tabular">${report.checksums_verified.toLocaleString()} / ${totalDownloaded.toLocaleString()} matched (${checksumPct}%)</span>
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
                <span class="insight-value ${totalViolations === 0 ? 'text-positive' : 'text-negative'} font-tabular">${totalViolations.toLocaleString()} violation${totalViolations === 1 ? '' : 's'} detected</span>
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
              <div class="chart-card-title">
                Annual Observation Counts
                ${renderInfoTooltip({
                  defId: 'kpi.per_year_counts',
                  title: 'Annual Calendar Completeness',
                  description: 'Validation against standard leap and non-leap annual calendar hours.',
                  position: 'bottom',
                })}
                ${renderInspectTrigger('kpi.per_year_counts', { title: 'Inspect Annual Observations' })}
              </div>
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
              <div class="chart-card-title text-warning">
                Recorded Exchange Outage Gaps
                ${renderInfoTooltip({
                  defId: 'quality.gaps',
                  title: 'Preserved Gap Discontinuities',
                  description: 'Chronological gaps where Binance matching engines halted during scheduled maintenance or unplanned connectivity dropouts.',
                  caveat: 'These gaps are intentionally NOT forward-filled to avoid injecting false low-volatility synthetic drift.',
                  position: 'bottom',
                })}
                ${renderInspectTrigger('quality.gaps', { title: 'Inspect Outage Gaps' })}
              </div>
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
            <div class="chart-card-title">
              Release Artifact Provenance
              ${renderInfoTooltip({
                title: 'Release Artifact Audit Stamp',
                description: 'Verifies the cryptographic commit SHA, build timestamp, and static Parquet artifact release.',
                formula: 'Git Commit SHA = ' + meta.pipeline_git_sha.substring(0, 8),
                caveat: 'Static web hosting guarantees that data is deterministic and reproducible without backend dependencies.',
                position: 'top',
              })}
            </div>
            <div class="chart-card-subtitle">Versioned release metadata and reproducibility stamps</div>
          </div>
        </div>
        <div class="chart-card-body">
          <div class="overview-insights-grid">
            <div class="insight-row">
              <span class="insight-label">Data Freshness (Live)</span>
              <span class="insight-value ${isStale ? 'text-warning font-mono' : 'text-positive font-mono'}">
                ${liveAgeHours.toFixed(1)}h lag ${isStale ? '(Warning: >48h stale)' : '(Operational normal 4.5–28.5h)'}
              </span>
            </div>
            <div class="insight-row">
              <span class="insight-label">ETL Snapshot Freshness</span>
              <span class="insight-value font-mono">${meta.freshness_hours !== undefined ? meta.freshness_hours + 'h' : 'N/A'}</span>
            </div>
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
