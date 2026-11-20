/**
 * Verification Playground Tab Component (Phase B).
 * Provides an interactive in-browser SQL console powered by DuckDB-WASM over the release Parquet artifact.
 *
 * Rules:
 * - Read-only allowlist: statements must start with SELECT/WITH after comment stripping
 * - Catalog of registry queries pre-filled with current filters
 * - Direct execution in Web Worker via executeQuery
 * - Results grid capped at 500 rows with honest truncation notice
 * - Schema inspector ("DESCRIBE klines")
 * - Side-by-side "Compare with App" validation for catalog queries
 */

import type { KlineRow, Meta, QualityReport } from '../types';
import { getAllMetricDefs, getMetricDef, type MetricDef } from '../verify/registry';
import { validateSql } from '../verify/sql_validator';
import { executeQuery, type QueryResult } from '../verify/engine';
import { compareAppAndSqlResults } from '../verify/parity';
import { setBadgeResult } from '../verify/badges';

export interface PlaygroundContext {
  data: KlineRow[];
  meta: Meta | null;
  qualityData: QualityReport | null;
  startMs?: number;
  endMs?: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createPlaygroundView(container: HTMLElement, getContext: () => PlaygroundContext): void {
  const allDefs = getAllMetricDefs().filter((d) => d.kind !== 'provenance' && !!d.sql);

  // Group definitions for catalog
  const groups: Record<string, MetricDef[]> = {
    'Overview KPIs': allDefs.filter((d) => d.id.startsWith('kpi.')),
    'Seasonality (Hourly & DOW)': allDefs.filter((d) => d.id.startsWith('seasonality.')),
    '7×24 Heatmap Matrix': allDefs.filter((d) => d.id.startsWith('heatmap.')),
    'Volatility & Distribution': allDefs.filter((d) => d.id.startsWith('volatility.')),
    'Order Flow': allDefs.filter((d) => d.id.startsWith('flow.')),
    'Calendar & Risk': allDefs.filter((d) => d.id.startsWith('calendar.')),
  };

  container.innerHTML = `
    <div class="playground-container" style="max-width: 1400px; margin: 0 auto; padding: 24px 16px;">
      <!-- Header -->
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
          <div>
            <h1 class="text-2xl font-bold" style="margin: 0 0 6px 0; display: flex; align-items: center; gap: 8px;">
              <span>Verification Playground</span>
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                DuckDB-WASM EH
              </span>
            </h1>
            <p class="text-sm text-[var(--text-muted)]" style="margin: 0; max-width: 800px;">
              Query the BTCUSDT 1h Parquet release artifact directly using self-hosted DuckDB-WASM running in your browser.
              Statements are evaluated inside an isolated Web Worker with zero network calls.
            </p>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-describe-schema">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <line x1="2" y1="6" x2="14" y2="6" />
                <line x1="6" y1="6" x2="6" y2="14" />
              </svg>
              View Schema (DESCRIBE)
            </button>
          </div>
        </div>
      </div>

      <!-- Controls & Editor Card -->
      <div class="card" style="margin-bottom: 24px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 280px;">
            <label for="catalog-select" class="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Query Catalog:
            </label>
            <select id="catalog-select" class="form-select text-sm font-mono" style="flex: 1; max-width: 420px; background: var(--surface-card); border: 1px solid var(--border-subtle); color: var(--text-normal); border-radius: 6px; padding: 6px 10px;">
              <option value="">-- Select a Registry Query Template --</option>
              ${Object.entries(groups)
                .map(
                  ([grpName, defs]) => `
                    <optgroup label="${escapeHtml(grpName)}">
                      ${defs
                        .map(
                          (d) => `
                            <option value="${escapeHtml(d.id)}">${escapeHtml(d.label)} (${escapeHtml(d.id)})</option>
                          `
                        )
                        .join('')}
                    </optgroup>
                  `
                )
                .join('')}
            </select>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-format-sql" title="Reset to default catalog template">
              Reset Query
            </button>
            <button type="button" class="btn btn-primary" id="btn-execute-sql" style="min-width: 130px; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <polygon points="4,2 14,8 4,14" />
              </svg>
              <span>Run (Ctrl+↵)</span>
            </button>
          </div>
        </div>

        <!-- SQL Editor -->
        <div style="position: relative;">
          <textarea id="sql-editor"
                    class="font-mono text-sm"
                    spellcheck="false"
                    style="width: 100%; min-height: 160px; padding: 12px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--surface-muted); color: var(--text-normal); resize: vertical; line-height: 1.5;"
                    placeholder="-- Type your read-only SELECT or WITH query here...&#10;SELECT * FROM klines LIMIT 10;">SELECT count(*) AS total_bars,
       min(open_time_ms) AS first_ms,
       max(open_time_ms) AS last_ms,
       round(avg(volume), 2) AS mean_volume_btc
FROM klines;</textarea>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 11px; color: var(--text-muted);">
          <span>Read-only allowlist: Only <code>SELECT</code> and <code>WITH</code> statements permitted. DDL/DML rejected.</span>
          <span>Press <kbd style="background: var(--surface-muted); border: 1px solid var(--border-subtle); border-radius: 3px; padding: 1px 4px;">Ctrl</kbd> + <kbd style="background: var(--surface-muted); border: 1px solid var(--border-subtle); border-radius: 3px; padding: 1px 4px;">Enter</kbd> to execute</span>
        </div>

        <!-- Error / Validation Banner -->
        <div id="sql-validation-error" style="display: none; margin-top: 12px;" class="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-400 font-mono"></div>

        <!-- Compare with App Panel (for Catalog queries) -->
        <div id="compare-app-panel" style="display: none; margin-top: 16px; border-top: 1px solid var(--border-subtle); padding-top: 14px;"></div>
      </div>

      <!-- Results Section -->
      <div class="card" style="padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <h3 class="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]" style="margin: 0;">
              Query Results
            </h3>
            <span id="results-stats" class="text-xs font-mono text-[var(--text-muted)]"></span>
          </div>

          <button type="button" class="btn btn-secondary btn-sm" id="btn-export-results-csv" style="display: none;">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
              <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
              <polyline points="5 8 8 11 11 8" />
              <line x1="8" y1="2" x2="8" y2="11" />
            </svg>
            Export Results CSV
          </button>
        </div>

        <div id="results-table-wrap" class="inspect-table-wrap" style="max-height: 480px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: 6px;">
          <div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">
            Select a template from the catalog or write an SQL query and click <strong>Run</strong>.
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach elements and event listeners
  const catalogSelect = container.querySelector('#catalog-select') as HTMLSelectElement;
  const sqlEditor = container.querySelector('#sql-editor') as HTMLTextAreaElement;
  const executeBtn = container.querySelector('#btn-execute-sql') as HTMLButtonElement;
  const formatBtn = container.querySelector('#btn-format-sql') as HTMLButtonElement;
  const describeBtn = container.querySelector('#btn-describe-schema') as HTMLButtonElement;
  const errorBanner = container.querySelector('#sql-validation-error') as HTMLElement;
  const comparePanel = container.querySelector('#compare-app-panel') as HTMLElement;
  const resultsStats = container.querySelector('#results-stats') as HTMLElement;
  const resultsWrap = container.querySelector('#results-table-wrap') as HTMLElement;
  const exportCsvBtn = container.querySelector('#btn-export-results-csv') as HTMLButtonElement;

  let lastResultRows: Array<Record<string, any>> = [];
  let lastResultColumns: string[] = [];

  function getQueryForDef(defId: string): string {
    const def = getMetricDef(defId);
    if (!def || !def.sql) return '';
    const currentCtx = getContext();
    return def.sql({
      startMs: currentCtx.startMs,
      endMs: currentCtx.endMs,
      bucket: 'hour',
      window: 168,
    });
  }

  catalogSelect?.addEventListener('change', () => {
    const selectedId = catalogSelect.value;
    if (!selectedId) return;
    const generatedSql = getQueryForDef(selectedId);
    if (generatedSql) {
      sqlEditor.value = generatedSql;
      errorBanner.style.display = 'none';
      comparePanel.style.display = 'none';
    }
  });

  formatBtn?.addEventListener('click', () => {
    const selectedId = catalogSelect.value;
    if (selectedId) {
      const generatedSql = getQueryForDef(selectedId);
      if (generatedSql) sqlEditor.value = generatedSql;
    }
  });

  describeBtn?.addEventListener('click', () => {
    sqlEditor.value = 'DESCRIBE klines;';
    runQuery();
  });

  // Ctrl + Enter hotkey
  sqlEditor?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  });

  executeBtn?.addEventListener('click', runQuery);

  async function runQuery(): Promise<void> {
    const rawSql = sqlEditor.value;
    errorBanner.style.display = 'none';
    comparePanel.style.display = 'none';

    // 1. Allowlist validation
    const validation = validateSql(rawSql);
    if (!validation.valid) {
      errorBanner.textContent = `Query rejected by security allowlist: ${validation.error}`;
      errorBanner.style.display = 'block';
      return;
    }

    const sqlToRun = validation.sanitizedSql!;

    // 2. Loading state
    executeBtn.disabled = true;
    executeBtn.innerHTML = `
      <svg class="animate-spin" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="8" cy="8" r="6" stroke-dasharray="10 20" />
      </svg>
      <span>Executing...</span>
    `;

    resultsStats.textContent = 'Querying DuckDB-WASM...';
    resultsWrap.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">
        <div class="inline-block animate-spin" style="margin-bottom: 8px;">⏳</div>
        <div>Evaluating query against local Parquet table...</div>
      </div>
    `;

    try {
      const queryResult = await executeQuery(sqlToRun, {
        releaseId: getContext().meta?.release_id,
        maxRows: 500,
      });

      lastResultRows = queryResult.rows;
      lastResultColumns = queryResult.columns;

      renderResults(queryResult);

      // Check if current query corresponds to selected catalog def for "Compare with App"
      const selectedDefId = catalogSelect.value;
      if (selectedDefId) {
        checkAppComparison(selectedDefId, queryResult);
      }
    } catch (err: any) {
      resultsStats.textContent = 'Error';
      resultsWrap.innerHTML = `
        <div style="padding: 24px; color: var(--color-negative); font-size: 13px;">
          <strong>DuckDB Execution Error:</strong>
          <pre class="inspect-trace-json font-mono mt-2" style="background: rgba(244, 63, 94, 0.05); border-color: rgba(244, 63, 94, 0.2);">${escapeHtml(err?.message || String(err))}</pre>
        </div>
      `;
    } finally {
      executeBtn.disabled = false;
      executeBtn.innerHTML = `
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <polygon points="4,2 14,8 4,14" />
        </svg>
        <span>Run (Ctrl+↵)</span>
      `;
    }
  }

  function renderResults(result: QueryResult): void {
    const countStr = result.truncated
      ? `Showing first 500 of ${result.rowCount.toLocaleString()} rows (capped)`
      : `${result.rowCount.toLocaleString()} rows`;

    resultsStats.innerHTML = `<strong>${countStr}</strong> · <span class="text-emerald-400 font-semibold">${result.durationMs.toFixed(1)} ms</span>`;

    exportCsvBtn.style.display = result.rowCount > 0 ? 'inline-flex' : 'none';

    if (result.rowCount === 0) {
      resultsWrap.innerHTML = `
        <div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 13px;">
          Query executed successfully in ${result.durationMs.toFixed(1)} ms. (0 rows returned)
        </div>
      `;
      return;
    }

    const headerHtml = result.columns.map((c) => `<th class="font-mono text-xs">${escapeHtml(c)}</th>`).join('');

    const rowsHtml = result.rows
      .map((row) => {
        const cells = result.columns
          .map((col) => {
            const val = row[col];
            const formatted = val === null || val === undefined ? '<span class="text-[var(--text-muted)] italic">NULL</span>' : escapeHtml(String(val));
            const isNumeric = typeof val === 'number';
            return `<td class="${isNumeric ? 'right font-tabular' : ''} font-mono text-xs">${formatted}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    resultsWrap.innerHTML = `
      <table class="data-table inspect-data-table" style="width: 100%;">
        <thead>
          <tr>${headerHtml}</tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  function checkAppComparison(defId: string, queryResult: QueryResult): void {
    const def = getMetricDef(defId);
    if (!def) return;

    const currentCtx = getContext();
    const appResult = def.compute(currentCtx.data, {
      startMs: currentCtx.startMs,
      endMs: currentCtx.endMs,
      bucket: 'hour',
      window: 168,
    });

    const comp = compareAppAndSqlResults(def, appResult, queryResult.rows);

    // Update in-memory badge store
    setBadgeResult(
      {
        defId,
        status: comp.status,
        matchedCount: comp.matchedCount,
        totalCount: comp.totalCount,
        maxDelta: comp.maxDelta,
        details: comp.details,
        sql: sqlEditor.value,
        durationMs: queryResult.durationMs,
      },
      { startMs: currentCtx.startMs, endMs: currentCtx.endMs }
    );

    const isMatch = comp.status === 'match';
    const statusBg = isMatch ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    const statusIcon = isMatch ? '✓ PARITY VERIFIED' : '✗ PARITY MISMATCH';

    comparePanel.style.display = 'block';
    comparePanel.innerHTML = `
      <div class="rounded border p-3 ${statusBg} text-xs">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <strong style="font-size: 13px;">${statusIcon}</strong>
            <span class="font-mono text-[var(--text-normal)]">Metric: ${escapeHtml(def.label)}</span>
          </div>
          <span class="font-mono">${comp.matchedCount} / ${comp.totalCount} matched</span>
        </div>
        <div style="color: var(--text-muted); font-size: 11px;">
          Tolerance: ±${def.tolerance.abs} abs / ${def.tolerance.rel} rel · Max observed Δ: <code class="font-mono">${comp.maxDelta.toExponential(4)}</code>
        </div>
      </div>
    `;
  }

  // Export Results CSV
  exportCsvBtn?.addEventListener('click', () => {
    if (lastResultRows.length === 0 || lastResultColumns.length === 0) return;

    const header = lastResultColumns.join(',');
    const lines = lastResultRows.map((r) =>
      lastResultColumns
        .map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return '';
          const str = String(v);
          return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(',')
    );

    const csvContent = [header, ...lines].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `playground_query_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
