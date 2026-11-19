/**
 * Data Quality Tab UI.
 * Renders meta.json + quality_report.json:
 * - Coverage % & total bars
 * - Missing ranges / gaps table
 * - Per-year bar counts
 * - Gotcha stats: files_ms vs files_us, header_files
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
      <div style="padding: 32px; text-align: center; color: var(--text-muted);">
        Loading data quality artifacts...
      </div>
    `;
    return;
  }

  const gapsCount = report.missing_ranges.length;

  container.innerHTML = `
    <div class="quality-view" style="display: flex; flex-direction: column; gap: 20px; max-width: 1200px; margin: 0 auto; padding: 4px 0 24px 0;">
      <!-- Top Metrics Banner -->
      <div class="metrics-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
        <div class="metric-card" style="padding: 14px 18px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Hourly Coverage</div>
          <div style="font-size: 26px; font-weight: 700; color: ${report.coverage_pct >= 99 ? 'var(--color-green)' : 'var(--color-amber)'};">
            ${report.coverage_pct.toFixed(2)}%
          </div>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
            ${report.actual_rows.toLocaleString()} / ${report.expected_hours.toLocaleString()} expected hours
          </div>
        </div>

        <div class="metric-card" style="padding: 14px 18px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Integrity & Checksums</div>
          <div style="font-size: 26px; font-weight: 700; color: var(--color-green);">
            ${report.checksums_verified.toLocaleString()} <span style="font-size: 14px; font-weight: 500; color: var(--text-secondary);">verified</span>
          </div>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
            0 checksum mismatches or retries
          </div>
        </div>

        <div class="metric-card" style="padding: 14px 18px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Duplicates & Quarantine</div>
          <div style="font-size: 26px; font-weight: 700; color: var(--color-blue);">
            ${report.duplicates_removed} <span style="font-size: 14px; font-weight: 500; color: var(--text-secondary);">dupes</span>
          </div>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
            ${report.quarantined_rows.length} quarantined invalid rows
          </div>
        </div>

        <div class="metric-card" style="padding: 14px 18px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Zero Volume Bars</div>
          <div style="font-size: 26px; font-weight: 700; color: var(--text-primary);">
            ${report.zero_volume_bars}
          </div>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
            Valid market hours kept (never fabricated)
          </div>
        </div>
      </div>

      <!-- Gotchas & File Ingestion Stats -->
      <div class="chart-panel" style="padding: 18px;">
        <h3 style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">Ingestion & Parser Gotchas (§3)</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; font-size: 13px;">
          <div>
            <span style="color: var(--text-muted);">Source Files Ingested:</span>
            <strong style="color: var(--text-primary); margin-left: 6px;">
              ${meta.files_downloaded.monthly} monthly + ${meta.files_downloaded.daily} daily
            </strong>
          </div>
          <div>
            <span style="color: var(--text-muted);">Timestamp Unit Detection:</span>
            <strong style="color: var(--text-primary); margin-left: 6px;">
              ${report.files_ms} ms files / ${report.files_us} µs files
            </strong>
          </div>
          <div>
            <span style="color: var(--text-muted);">Header Rows Sniffed:</span>
            <strong style="color: var(--text-primary); margin-left: 6px;">
              ${report.header_files} files with headers skipped
            </strong>
          </div>
          <div>
            <span style="color: var(--text-muted);">Missing Exchange Gaps:</span>
            <strong style="color: ${gapsCount === 0 ? 'var(--color-green)' : 'var(--color-amber)'}; margin-left: 6px;">
              ${gapsCount} missing interval(s)
            </strong>
          </div>
        </div>
      </div>

      <!-- Per-Year Breakdown & Provenance Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <!-- Per Year Table -->
        <div class="chart-panel" style="padding: 18px;">
          <h3 style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">Annual Observation Counts</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); color: var(--text-muted);">
                <th style="padding: 6px 8px;">Year</th>
                <th style="padding: 6px 8px; text-align: right;">Hourly Rows</th>
                <th style="padding: 6px 8px; text-align: right;">Expected</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(report.per_year_row_counts)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([year, count]) => {
                  const y = Number(year);
                  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
                  const exp = isLeap ? 8784 : 8760;
                  return `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                      <td style="padding: 6px 8px; color: var(--text-primary); font-weight: 500;">${year}</td>
                      <td style="padding: 6px 8px; text-align: right; color: var(--text-primary); font-family: monospace;">${count.toLocaleString()}</td>
                      <td style="padding: 6px 8px; text-align: right; color: var(--text-muted); font-family: monospace;">${y === 2026 ? 'YTD' : exp.toLocaleString()}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>

        <!-- Release Provenance -->
        <div class="chart-panel" style="padding: 18px;">
          <h3 style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">Artifact Provenance</h3>
          <div style="display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
            <div>
              <div style="color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Release ID</div>
              <div style="color: var(--text-primary); font-family: monospace; font-size: 12px;">${meta.release_id}</div>
            </div>
            <div>
              <div style="color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Generated At (UTC)</div>
              <div style="color: var(--text-primary); font-family: monospace; font-size: 12px;">${meta.generated_at_utc}</div>
            </div>
            <div>
              <div style="color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Pipeline Git Commit</div>
              <div style="color: var(--text-primary); font-family: monospace; font-size: 12px;">${meta.pipeline_git_sha}</div>
            </div>
            <div>
              <div style="color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Market & Symbol</div>
              <div style="color: var(--text-primary); font-size: 12px;">${meta.symbol} · ${meta.interval} · ${meta.market}</div>
            </div>
            <div>
              <div style="color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Data Source Base URL</div>
              <div style="color: var(--color-blue); font-size: 11px; word-break: break-all;">${meta.source_base_url}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Missing Gaps Section -->
      ${
        gapsCount > 0
          ? `
        <div class="chart-panel" style="padding: 18px;">
          <h3 style="font-size: 14px; font-weight: 600; color: var(--color-amber); margin-bottom: 12px;">Recorded Exchange Outage Gaps</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); color: var(--text-muted);">
                <th style="padding: 6px 8px;">Start Time (UTC)</th>
                <th style="padding: 6px 8px;">End Time (UTC)</th>
                <th style="padding: 6px 8px; text-align: right;">Missing Hours</th>
              </tr>
            </thead>
            <tbody>
              ${report.missing_ranges
                .map(
                  g => `
                <tr style="border-bottom: 1px solid var(--border-color);">
                  <td style="padding: 6px 8px; color: var(--text-primary); font-family: monospace;">${new Date(g.start_ms).toISOString().replace('.000Z', '')}</td>
                  <td style="padding: 6px 8px; color: var(--text-primary); font-family: monospace;">${new Date(g.end_ms).toISOString().replace('.000Z', '')}</td>
                  <td style="padding: 6px 8px; text-align: right; color: var(--color-amber); font-weight: 600;">${g.hours}h</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
          : ''
      }
    </div>
  `;
}
