/**
 * Inspect Drawer Component (Phase A).
 * "Every Number Shows Its Work"
 *
 * Provides a slide-over panel showing:
 * 1. Definition (formula, unit, conventions)
 * 2. Inputs (filter echo, target echo, rows in range, n used/excluded)
 * 3. Trace (computation intermediates computed live on open)
 * 4. Data (first 5 + last 5 rows preview, deterministic RFC4180 CSV export)
 * 5. Provenance (release ID, git sha, generated_at, source files)
 * 6. Actions (Recompute live wiring check, Copy proof link, Cross-check SQL placeholder)
 */

import type { KlineRow, Meta, QualityReport } from '../types';
import { getMetricDef, type Result } from './registry';
import { createProofLink } from './links';
import { generatePlainLanguageProof, recomputeFromInstances } from '../validation/proof';
import { downloadExcel } from '../validation/export';

export interface OpenDrawerOptions {
  defId: string;
  data: KlineRow[];
  meta: Meta | null;
  qualityData: QualityReport | null;
  currentTab?: string;
  metric?: string;
  bucket?: string;
  window?: number;
  target?: string;
  startMs?: number;
  endMs?: number;
  proofReleaseId?: string;
}

let activeDrawerEl: HTMLElement | null = null;
let activeBackdropEl: HTMLElement | null = null;
let previousActiveElement: HTMLElement | null = null;
let escapeKeyHandler: ((e: KeyboardEvent) => void) | null = null;

const DOW_FULL_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/**
 * Formats a target coordinate into human-readable text.
 */
export function formatTargetLabel(target: string, bucket?: string): string {
  if (target.includes(':')) {
    const [dStr, hStr] = target.split(':');
    const d = Number(dStr);
    const h = Number(hStr);
    const dowName = DOW_FULL_NAMES[d] ?? `DOW ${d}`;
    return `${dowName} ${String(h).padStart(2, '0')}:00 UTC (DOW ${d}, Hour ${h})`;
  }

  if (target.includes('-')) {
    // e.g. "2024-03" (YYYY-MM)
    const [yStr, mStr] = target.split('-');
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const mIdx = Number(mStr) - 1;
    return `${monthNames[mIdx] ?? mStr} ${yStr}`;
  }

  if (/^\d{4}$/.test(target)) {
    // e.g. "2024" (YTD)
    return `Year ${target} (YTD)`;
  }

  const num = Number(target);
  if (!isNaN(num)) {
    if (bucket === 'dow') {
      return `${DOW_FULL_NAMES[num] ?? `Day ${num}`} (DOW ${num})`;
    }
    return `Hour ${String(num).padStart(2, '0')}:00 UTC`;
  }

  return target;
}

/**
 * Filters the dataset down to the specific scoped target if specified.
 */
export function getScopedSubset(data: KlineRow[], target?: string, bucket?: string): KlineRow[] {
  if (!target) return data;

  if (target.includes(':')) {
    const [dStr, hStr] = target.split(':');
    const d = Number(dStr);
    const h = Number(hStr);
    return data.filter((r) => r.dow === d && r.hour === h);
  }

  if (target.includes('-')) {
    const [yStr, mStr] = target.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    return data.filter((r) => {
      const dt = new Date(r.open_time_ms);
      return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m;
    });
  }

  if (/^\d{4}$/.test(target)) {
    const y = Number(target);
    return data.filter((r) => new Date(r.open_time_ms).getUTCFullYear() === y);
  }

  const num = Number(target);
  if (!isNaN(num)) {
    if (bucket === 'dow') {
      return data.filter((r) => r.dow === num);
    }
    return data.filter((r) => r.hour === num);
  }

  return data;
}

/**
 * Generates an RFC4180-compliant CSV string containing all 15 columns for the subset rows.
 */
export function generateSubsetCsv(rows: KlineRow[]): string {
  const headers = [
    'open_time_ms',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'quote_volume',
    'trades',
    'taker_buy_volume',
    'taker_buy_quote_volume',
    'log_ret',
    'hour',
    'dow',
    'taker_buy_ratio',
    'hl_range',
  ];

  const sortedRows = [...rows].sort((a, b) => a.open_time_ms - b.open_time_ms);
  const lines: string[] = [headers.join(',')];

  for (const r of sortedRows) {
    const rowValues = [
      r.open_time_ms,
      r.open,
      r.high,
      r.low,
      r.close,
      r.volume,
      r.quote_volume,
      r.trades,
      r.taker_buy_volume,
      r.taker_buy_quote_volume,
      r.log_ret !== null && r.log_ret !== undefined ? r.log_ret : '',
      r.hour,
      r.dow,
      r.taker_buy_ratio !== null && r.taker_buy_ratio !== undefined ? r.taker_buy_ratio : '',
      r.hl_range,
    ];
    lines.push(rowValues.join(','));
  }

  return lines.join('\r\n') + '\r\n';
}

/**
 * Triggers a client-side browser file download for text/csv content.
 */
export function triggerCsvDownload(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Escapes HTML characters.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Closes the active drawer and removes event listeners.
 */
export function closeInspectDrawer(): void {
  if (typeof document === 'undefined') return;

  if (escapeKeyHandler) {
    document.removeEventListener('keydown', escapeKeyHandler);
    escapeKeyHandler = null;
  }

  if (activeDrawerEl) {
    activeDrawerEl.classList.remove('open');
    setTimeout(() => {
      activeDrawerEl?.remove();
      activeDrawerEl = null;
    }, 200);
  }

  if (activeBackdropEl) {
    activeBackdropEl.classList.remove('open');
    setTimeout(() => {
      activeBackdropEl?.remove();
      activeBackdropEl = null;
    }, 200);
  }

  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    previousActiveElement.focus();
    previousActiveElement = null;
  }
}

/**
 * Pure function rendering the drawer HTML string.
 */
export function renderInspectDrawerHtml(options: OpenDrawerOptions): string {
  const def = getMetricDef(options.defId);
  if (!def) {
    return `<div class="inspect-drawer"><div class="drawer-notice-warning">Unknown metric: ${escapeHtml(options.defId)}</div></div>`;
  }

  const subset = getScopedSubset(options.data, options.target, options.bucket);
  const result: Result = def.compute(
    subset,
    {
      bucket: options.bucket,
      metric: options.metric,
      window: options.window,
      startMs: options.startMs,
      endMs: options.endMs,
    },
    { meta: options.meta, qualityData: options.qualityData }
  );

  const startMs = options.startMs ?? (options.data[0]?.open_time_ms ?? 0);
  const endMs = options.endMs ?? (options.data[options.data.length - 1]?.open_time_ms ?? 0);
  const startIso = startMs > 0 ? new Date(startMs).toISOString().replace('.000Z', ' UTC') : '—';
  const endIso = endMs > 0 ? new Date(endMs).toISOString().replace('.000Z', ' UTC') : '—';

  const validRets = subset.filter((r) => r.log_ret !== null && r.log_ret !== undefined).map((r) => r.log_ret as number);
  const nullRetsCount = subset.length - validRets.length;
  const totalVolume = subset.reduce((sum, r) => sum + r.volume, 0);
  const totalTakerBuyVol = subset.reduce((sum, r) => sum + r.taker_buy_volume, 0);
  const sumLogRet = validRets.reduce((a, b) => a + b, 0);
  const sumLogRetSq = validRets.reduce((a, b) => a + b * b, 0);

  // Mismatch banner
  const hasReleaseMismatch =
    Boolean(options.proofReleaseId) &&
    Boolean(options.meta?.release_id) &&
    options.proofReleaseId !== options.meta?.release_id;

  const mismatchHtml = hasReleaseMismatch
    ? `
      <div class="drawer-notice-warning" role="alert">
        <span>⚠️ Notice: This proof link was created against release <strong>${escapeHtml(options.proofReleaseId!)}</strong>, but the currently active dataset is <strong>${escapeHtml(options.meta?.release_id ?? '')}</strong>.</span>
      </div>
    `
    : '';

  // Data Preview Rows (first 5 + last 5)
  const sortedSubset = [...subset].sort((a, b) => a.open_time_ms - b.open_time_ms);
  let previewRows: KlineRow[] = [];
  let hasTruncation = false;
  if (sortedSubset.length <= 10) {
    previewRows = sortedSubset;
  } else {
    hasTruncation = true;
    previewRows = [...sortedSubset.slice(0, 5), ...sortedSubset.slice(-5)];
  }

  // Display value for this computation
  let displayValueStr = '—';
  if (result.kind === 'scalar') {
    displayValueStr = def.format(result.value);
  } else if (result.kind === 'series') {
    displayValueStr = `${result.summary.n} points · mean ${def.format(result.summary.mean)}`;
  } else if (result.kind === 'grouped' || result.kind === 'matrix') {
    if (options.target) {
      const match = result.keys.find((k) => String(k.key) === options.target);
      displayValueStr = match ? def.format(match.value) : `${result.keys.length} items`;
    } else {
      displayValueStr = `${result.keys.length} buckets computed`;
    }
  } else if (result.kind === 'provenance') {
    displayValueStr = 'Verified Provenance';
  }

  const targetEchoHtml = options.target
    ? `
      <div class="inspect-field-row">
        <span class="inspect-field-label">Target Scope</span>
        <strong class="inspect-field-val text-info">${escapeHtml(formatTargetLabel(options.target, options.bucket))}</strong>
      </div>
    `
    : '';

  const rawDisplayed = result.kind === 'scalar' ? result.value : (subset[0]?.close ?? 0);
  const plainProof = generatePlainLanguageProof({
    def,
    displayedValue: rawDisplayed,
    instances: subset,
    meta: options.meta,
    qualityData: options.qualityData,
  });

  return `
    <div class="inspect-drawer-header">
      <div class="inspect-drawer-title-group">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h2 class="inspect-drawer-title">${escapeHtml(def.label)}</h2>
          <span class="badge badge-info">${escapeHtml(def.kind.toUpperCase())}</span>
          <span class="badge">${escapeHtml(def.unit)}</span>
        </div>
        <span class="inspect-drawer-subtitle">Definition ID: <code>${escapeHtml(def.id)}</code></span>
      </div>
      <button type="button" class="inspect-close-btn" aria-label="Close inspection drawer">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="3" y1="3" x2="13" y2="13" />
          <line x1="13" y1="3" x2="3" y2="13" />
        </svg>
      </button>
    </div>

    ${mismatchHtml}

    <div class="inspect-drawer-content">
      <!-- Current Computed Value Banner -->
      <div class="inspect-value-card">
        <span class="inspect-value-label">Evaluated Metric Value</span>
        <div class="inspect-value-num">${escapeHtml(displayValueStr)}</div>
        <span class="inspect-value-sub">Computed over ${subset.length.toLocaleString()} observations</span>
      </div>

      <!-- Section 1: Definition -->
      <section class="inspect-section">
        <h3 class="inspect-section-title">1. Mathematical Definition</h3>
        <div class="inspect-field-block">
          <span class="inspect-field-label">Canonical Formula</span>
          <code class="inspect-formula-code">${escapeHtml(def.formula)}</code>
        </div>
        <div class="inspect-field-block">
          <span class="inspect-field-label">Statistical Conventions</span>
          <ul class="inspect-conventions-list">
            ${def.conventions.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}
          </ul>
        </div>
      </section>

      <!-- Section 2: Inputs -->
      <section class="inspect-section">
        <h3 class="inspect-section-title">2. Scope &amp; Inputs</h3>
        <div class="inspect-fields-grid">
          <div class="inspect-field-row">
            <span class="inspect-field-label">Time Range</span>
            <span class="inspect-field-val font-mono">${escapeHtml(startIso)} → ${escapeHtml(endIso)}</span>
          </div>
          ${targetEchoHtml}
          ${options.window ? `
            <div class="inspect-field-row">
              <span class="inspect-field-label">Rolling Window</span>
              <span class="inspect-field-val">${options.window} hours</span>
            </div>
          ` : ''}
          <div class="inspect-field-row">
            <span class="inspect-field-label">Observations in Range</span>
            <span class="inspect-field-val font-tabular">${options.data.length.toLocaleString()} bars</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Evaluated in Subset</span>
            <span class="inspect-field-val font-tabular font-bold">${subset.length.toLocaleString()} bars</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Valid Non-Null Returns</span>
            <span class="inspect-field-val font-tabular">${validRets.length.toLocaleString()}</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Excluded (Null / Outage)</span>
            <span class="inspect-field-val font-tabular ${nullRetsCount > 0 ? 'text-warning' : ''}">${nullRetsCount}</span>
          </div>
        </div>
      </section>

      <!-- Section 3: Trace Intermediates -->
      <section class="inspect-section">
        <h3 class="inspect-section-title">3. Computation Trace Intermediates</h3>
        <div class="proof proof-panel-card" style="margin-bottom: 12px;">
          <strong style="display: block; margin-bottom: 4px;">Live Verification Proof:</strong>
          <span>${escapeHtml(plainProof)}</span>
        </div>
        <div class="inspect-fields-grid">
          <div class="inspect-field-row">
            <span class="inspect-field-label">Σ log_ret</span>
            <span class="inspect-field-val font-mono">${sumLogRet.toFixed(6)}</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Σ (log_ret)²</span>
            <span class="inspect-field-val font-mono">${sumLogRetSq.toFixed(6)}</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Total Volume (Σ V)</span>
            <span class="inspect-field-val font-mono">${totalVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })} BTC</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Taker Buy Volume (Σ V_tb)</span>
            <span class="inspect-field-val font-mono">${totalTakerBuyVol.toLocaleString('en-US', { maximumFractionDigits: 2 })} BTC</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Aggregate Taker Ratio</span>
            <span class="inspect-field-val font-mono">${totalVolume > 0 ? ((totalTakerBuyVol / totalVolume) * 100).toFixed(2) + '%' : '0.00%'}</span>
          </div>
        </div>
        ${Object.keys(result.trace).length > 0 ? `
          <div style="margin-top: 8px;">
            <span class="inspect-field-label">Metric Specific Intermediates</span>
            <pre class="inspect-trace-json">${escapeHtml(JSON.stringify(result.trace, null, 2))}</pre>
          </div>
        ` : ''}
      </section>

      <!-- Section 4: Data Preview & Export -->
      <section class="inspect-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
          <h3 class="inspect-section-title" style="margin: 0;">4. Exact Underlying Observations</h3>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-download-subset-csv">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
                <polyline points="5 8 8 11 11 8" />
                <line x1="8" y1="2" x2="8" y2="11" />
              </svg>
              Download Subset CSV (${subset.length.toLocaleString()} rows)
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-download-subset-excel" title="Download subset as Excel (.xlsx)">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                <rect x="2" y="2" width="12" height="12" rx="1.5" />
                <path d="M5 5l6 6M11 5l-6 6" />
              </svg>
              Download Excel
            </button>
          </div>
        </div>
        <p class="inspect-desc-text">
          ${options.defId === 'quality.gaps' && subset.length > 0
            ? 'Showing surrounding boundary context bars (last bar before outage and first bar after recovery).'
            : previewRows.length === 0
            ? 'Zero exchange bars exist within this missing range interval.'
            : `Showing ${hasTruncation ? 'first 5 and last 5 observations' : `${previewRows.length} observations`} of the exact filtered subset. All 15 columns available in RFC4180 CSV export.`}
        </p>
        ${previewRows.length === 0 ? `
          <div class="drawer-notice-info" style="padding: 14px; margin: 8px 0; background: var(--surface2); border: 1px dashed var(--line); border-radius: var(--r-sm); text-align: center; color: var(--muted); font-size: var(--text-xs);">
            <span>⚠️ Data gap — no exchange instances recorded during this outage window.</span>
          </div>
        ` : `
          <div class="inspect-table-wrap">
            <table class="data-table inspect-data-table">
              <thead>
                <tr>
                  <th>Open Time (UTC)</th>
                  <th class="right">Open</th>
                  <th class="right">Close</th>
                  <th class="right">Volume (BTC)</th>
                  <th class="right">Log Ret (bps)</th>
                </tr>
              </thead>
              <tbody>
                ${previewRows.map((r, i) => {
                  const dateStr = new Date(r.open_time_ms).toISOString().replace('.000Z', '').replace('T', ' ');
                  const retStr = r.log_ret !== null && r.log_ret !== undefined ? (r.log_ret * 10000).toFixed(1) : '—';
                  const isDivider = hasTruncation && i === 5;
                  const dividerHtml = isDivider
                    ? `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 4px; font-style: italic; background: var(--bg-hover);">... (${subset.length - 10} rows omitted in preview) ...</td></tr>`
                    : '';
                  return `
                    ${dividerHtml}
                    <tr>
                      <td class="font-mono" style="font-size: 11px;">${dateStr}</td>
                      <td class="right font-tabular">${r.open.toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>
                      <td class="right font-tabular">${r.close.toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>
                      <td class="right font-tabular">${r.volume.toFixed(1)}</td>
                      <td class="right font-tabular ${Number(retStr) >= 0 ? 'text-positive' : 'text-negative'}">${retStr}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </section>

      <!-- Section 5: Provenance -->
      <section class="inspect-section">
        <h3 class="inspect-section-title">5. Data Provenance &amp; Lineage</h3>
        <div class="inspect-fields-grid">
          <div class="inspect-field-row">
            <span class="inspect-field-label">Release ID</span>
            <span class="inspect-field-val font-mono">${escapeHtml(options.meta?.release_id ?? 'unknown')}</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Pipeline Git SHA</span>
            <span class="inspect-field-val font-mono">${escapeHtml(options.meta?.pipeline_git_sha ?? 'unknown')}</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Build Timestamp (UTC)</span>
            <span class="inspect-field-val font-mono">${escapeHtml(options.meta?.generated_at_utc ?? 'unknown')}</span>
          </div>
          <div class="inspect-field-row">
            <span class="inspect-field-label">Binance Source Ingest</span>
            <span class="inspect-field-val">${options.meta?.files_downloaded?.monthly ?? 0} monthly + ${options.meta?.files_downloaded?.daily ?? 0} daily ZIPs</span>
          </div>
        </div>
      </section>

      <!-- Section 6: Actions -->
      <section class="inspect-section">
        <h3 class="inspect-section-title">6. Audit Actions</h3>
        <div class="inspect-actions-grid">
          <button type="button" class="btn btn-secondary" id="btn-recompute-live">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 4v4h4" />
              <path d="M15 12v-4h-4" />
              <path d="M3.5 9a6 6 0 009.9-2.5M12.5 7a6 6 0 00-9.9 2.5" />
            </svg>
            Recompute Live (Wiring Check)
          </button>

          <button type="button" class="btn btn-secondary" id="btn-copy-proof-link">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            Copy Proof Link
          </button>
        </div>
        <div id="recompute-status-banner" style="margin-top: 8px;"></div>
      </section>
    </div>
  `;
}

/**
 * Opens the verification inspect drawer.
 */
export function openInspectDrawer(options: OpenDrawerOptions): void {
  if (typeof document === 'undefined') return;

  closeInspectDrawer();

  previousActiveElement = document.activeElement as HTMLElement | null;

  const def = getMetricDef(options.defId);
  if (!def) {
    console.error(`Unknown metric definition: ${options.defId}`);
    return;
  }

  const subset = getScopedSubset(options.data, options.target, options.bucket);

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'inspect-drawer-backdrop';
  backdrop.addEventListener('click', closeInspectDrawer);
  document.body.appendChild(backdrop);
  activeBackdropEl = backdrop;

  // Drawer container
  const drawer = document.createElement('aside');
  drawer.className = 'inspect-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', `Inspection: ${def.label}`);
  drawer.tabIndex = -1;

  const startMs = options.startMs ?? (options.data[0]?.open_time_ms ?? 0);
  const endMs = options.endMs ?? (options.data[options.data.length - 1]?.open_time_ms ?? 0);
  const filenameBase = options.target
    ? `${def.id}_${options.target.replace(/[:]/g, '-')}_${startMs}_${endMs}.csv`
    : `${def.id}_${startMs}_${endMs}.csv`;

  drawer.innerHTML = renderInspectDrawerHtml(options);

  document.body.appendChild(drawer);
  activeDrawerEl = drawer;

  // Animate in
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    drawer.classList.add('open');
    drawer.focus();
  });

  // Attach event handlers
  const closeBtn = drawer.querySelector('.inspect-close-btn') as HTMLButtonElement;
  closeBtn?.addEventListener('click', closeInspectDrawer);

  escapeKeyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeInspectDrawer();
    }
  };
  document.addEventListener('keydown', escapeKeyHandler);

  // CSV Download button
  const downloadBtn = drawer.querySelector('#btn-download-subset-csv') as HTMLButtonElement;
  downloadBtn?.addEventListener('click', () => {
    const csvContent = generateSubsetCsv(subset);
    triggerCsvDownload(csvContent, filenameBase);
  });

  // Excel Download button
  const downloadExcelBtn = drawer.querySelector('#btn-download-subset-excel') as HTMLButtonElement;
  downloadExcelBtn?.addEventListener('click', async () => {
    if (!downloadExcelBtn) return;
    const origHtml = downloadExcelBtn.innerHTML;
    downloadExcelBtn.disabled = true;
    downloadExcelBtn.innerHTML = '<span>Exporting...</span>';
    try {
      const exportCols = [
        { title: 'open_time_ms', field: 'open_time_ms' },
        { title: 'open', field: 'open' },
        { title: 'high', field: 'high' },
        { title: 'low', field: 'low' },
        { title: 'close', field: 'close' },
        { title: 'volume', field: 'volume' },
        { title: 'quote_volume', field: 'quote_volume' },
        { title: 'trades', field: 'trades' },
        { title: 'taker_buy_volume', field: 'taker_buy_volume' },
        { title: 'taker_buy_quote_volume', field: 'taker_buy_quote_volume' },
        { title: 'log_ret', field: 'log_ret' },
        { title: 'hour', field: 'hour' },
        { title: 'dow', field: 'dow' },
        { title: 'taker_buy_ratio', field: 'taker_buy_ratio' },
        { title: 'hl_range', field: 'hl_range' },
      ];
      await downloadExcel(filenameBase, 'Instances', exportCols, subset);
    } catch (err: any) {
      alert(`Excel export failed: ${err?.message || String(err)}`);
    } finally {
      downloadExcelBtn.disabled = false;
      downloadExcelBtn.innerHTML = origHtml;
    }
  });

  // Recompute button
  const recomputeBtn = drawer.querySelector('#btn-recompute-live') as HTMLButtonElement;
  const statusBanner = drawer.querySelector('#recompute-status-banner') as HTMLElement;
  recomputeBtn?.addEventListener('click', () => {
    const t0 = performance.now();
    const result = def.compute(
      subset,
      {
        bucket: options.bucket,
        metric: options.metric,
        window: options.window,
        startMs: options.startMs,
        endMs: options.endMs,
      },
      { meta: options.meta, qualityData: options.qualityData }
    );
    const displayedRaw = result.kind === 'scalar' ? result.value : (subset[0]?.close ?? 0);
    const recomputeRes = recomputeFromInstances({
      def,
      displayedValue: displayedRaw,
      instances: subset,
      params: {
        bucket: options.bucket,
        metric: options.metric,
        window: options.window,
        startMs: options.startMs,
        endMs: options.endMs,
      },
      meta: options.meta,
      qualityData: options.qualityData,
      targetKey: options.target,
    });
    const elapsed = (performance.now() - t0).toFixed(2);
    statusBanner.innerHTML = `
      <div class="alert ${recomputeRes.isMatch ? 'alert-positive' : 'alert-warning'}" style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; padding: 6px 10px; margin-top: 6px;">
        <span>✓ <strong>Wiring check passed:</strong> ${recomputeRes.message} in ${elapsed}ms (same code verification).</span>
        <span class="badge ${recomputeRes.isMatch ? 'badge-positive' : 'badge-warning'}">${recomputeRes.isMatch ? 'PASS' : 'WARN'}</span>
      </div>
    `;
  });

  // Copy proof link button
  const copyBtn = drawer.querySelector('#btn-copy-proof-link') as HTMLButtonElement;
  copyBtn?.addEventListener('click', async () => {
    const proofHash = createProofLink({
      tab: options.currentTab,
      defId: def.id,
      metric: options.metric,
      bucket: options.bucket,
      target: options.target,
      start: options.startMs,
      end: options.endMs,
      window: options.window,
      release_id: options.meta?.release_id,
    });

    const fullUrl = `${window.location.origin}${window.location.pathname}${proofHash}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      copyBtn.textContent = 'Copied to Clipboard!';
      setTimeout(() => {
        copyBtn.innerHTML = `
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
          Copy Proof Link
        `;
      }, 2000);
    } catch {
      window.location.hash = proofHash;
      copyBtn.textContent = 'Hash Updated in Address Bar';
    }
  });
}

export type AppContextGetter = () => {
  data: KlineRow[];
  meta: Meta | null;
  qualityData: QualityReport | null;
  currentTab: string;
  startMs?: number;
  endMs?: number;
};

let isGlobalInspectAttached = false;

/**
 * Attaches a global event listener for all inspect trigger buttons and inspect-verify buttons.
 */
export function setupInspectTriggers(getContext: AppContextGetter): void {
  if (isGlobalInspectAttached || typeof document === 'undefined') return;
  isGlobalInspectAttached = true;

  document.addEventListener('inspect-request', (event: Event) => {
    const customEvent = event as CustomEvent<{
      defId: string;
      bucket?: string;
      metric?: string;
      target?: string;
      window?: number;
    }>;
    const detail = customEvent.detail;
    if (!detail?.defId) return;

    // Unpin any open tooltips
    document.querySelectorAll('.info-tip.pinned').forEach((el) => el.classList.remove('pinned'));

    const ctx = getContext();
    openInspectDrawer({
      defId: detail.defId,
      data: ctx.data,
      meta: ctx.meta,
      qualityData: ctx.qualityData,
      currentTab: ctx.currentTab,
      bucket: detail.bucket,
      metric: detail.metric,
      target: detail.target,
      window: detail.window,
      startMs: ctx.startMs,
      endMs: ctx.endMs,
    });
  });

  document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest('[data-inspect-def]') as HTMLElement | null;
    if (!btn) return;

    const defId = btn.dataset.inspectDef;
    if (!defId) return;

    // Unpin any open tooltips
    document.querySelectorAll('.info-tip.pinned').forEach((el) => el.classList.remove('pinned'));

    const bucket = btn.dataset.inspectBucket;
    const metric = btn.dataset.inspectMetric;
    const targetVal = btn.dataset.inspectTarget;
    const windowVal = btn.dataset.inspectWindow ? Number(btn.dataset.inspectWindow) : undefined;

    const ctx = getContext();
    openInspectDrawer({
      defId,
      data: ctx.data,
      meta: ctx.meta,
      qualityData: ctx.qualityData,
      currentTab: ctx.currentTab,
      bucket,
      metric,
      target: targetVal,
      window: windowVal,
      startMs: ctx.startMs,
      endMs: ctx.endMs,
    });
  });
}
