/**
 * Modular Tabulator v6 Factory for Validation Tables.
 * Imports only Sort, Filter, Page, Download, Format, and Interaction modules.
 */

import {
  Tabulator,
  SortModule,
  FilterModule,
  PageModule,
  DownloadModule,
  FormatModule,
  InteractionModule,
  ResponsiveLayoutModule,
  FrozenColumnsModule,
  TooltipModule,
  type ColumnDefinition,
  type Options,
} from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator.min.css';
import { downloadCsv, downloadExcel, type ExportColumn } from './export';

// Register required Tabulator modules once
Tabulator.registerModule([
  SortModule,
  FilterModule,
  PageModule,
  DownloadModule,
  FormatModule,
  InteractionModule,
  ResponsiveLayoutModule,
  FrozenColumnsModule,
  TooltipModule,
]);

export interface ValidationTableOptions {
  data: any[];
  columns: ColumnDefinition[];
  pagination?: boolean;
  pageSize?: number;
  pageSizeSelector?: number[];
  exportFilename?: string;
  sheetName?: string;
  onRowClick?: (rowData: any) => void;
  height?: string | number;
  searchable?: boolean;
  layout?: Options['layout'];
}

export interface ValidationTableInstance {
  tabulator: Tabulator;
  destroy(): void;
  setData(data: any[]): Promise<void>;
  getData(): any[];
}

/**
 * Creates an interactive modular Tabulator instance inside container.
 */
export function createValidationTable(
  container: HTMLElement,
  options: ValidationTableOptions
): ValidationTableInstance {
  container.innerHTML = '';

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'validation-table-wrapper';

  // Toolbar (Export CSV, Export Excel, Filter, Row Count)
  const toolbar = document.createElement('div');
  toolbar.className = 'validation-table-toolbar';

  const rowCount = options.data.length;
  toolbar.innerHTML = `
    <div class="validation-table-meta">
      <span class="validation-row-count font-mono">${rowCount.toLocaleString('en-US')} rows</span>
    </div>
    <div class="validation-table-actions">
      <button type="button" class="btn btn-secondary btn-sm btn-export-csv" title="Export displayed data as CSV">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 2v8M4 7l4 4 4-4M2 13h12" />
        </svg>
        <span>Export CSV</span>
      </button>
      <button type="button" class="btn btn-secondary btn-sm btn-export-excel" title="Export displayed data as Excel (.xlsx)">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
          <path d="M5 5l6 6M11 5l-6 6" />
        </svg>
        <span>Export Excel</span>
      </button>
    </div>
  `;

  tableWrapper.appendChild(toolbar);

  const tableElement = document.createElement('div');
  tableElement.className = 'validation-tabulator-container';
  tableWrapper.appendChild(tableElement);
  container.appendChild(tableWrapper);

  const tabulatorOptions: Options = {
    data: options.data,
    columns: options.columns,
    columnDefaults: {
      headerTooltip: true,
    },
    layout: options.layout ?? 'fitColumns',
    responsiveLayout: 'collapse',
    responsiveLayoutCollapseStartOpen: false,
    pagination: options.pagination ?? true,
    paginationMode: 'local',
    paginationSize: options.pageSize ?? 20,
    paginationSizeSelector: options.pageSizeSelector ?? [10, 20, 50, 100],
    paginationCounter: 'rows',
    height: options.height ?? 'auto',
  };

  const tabulator = new Tabulator(tableElement, tabulatorOptions);

  if (options.onRowClick) {
    tabulator.on('rowClick', (_e, row) => {
      options.onRowClick!(row.getData());
    });
  }

  // Helper to extract ExportColumns from Tabulator column definitions
  const getExportColumns = (): ExportColumn[] => {
    return options.columns
      .filter((c) => c.field && c.field !== 'instances_view' && c.visible !== false)
      .map((c) => ({
        title: c.title || String(c.field),
        field: String(c.field),
      }));
  };

  // Wire CSV export
  const btnCsv = toolbar.querySelector<HTMLButtonElement>('.btn-export-csv');
  btnCsv?.addEventListener('click', () => {
    const filename = options.exportFilename || 'validation-export';
    const activeData = tabulator.getData('active');
    downloadCsv(filename, getExportColumns(), activeData);
  });

  // Wire Excel export (dynamic import of xlsx)
  const btnExcel = toolbar.querySelector<HTMLButtonElement>('.btn-export-excel');
  btnExcel?.addEventListener('click', async () => {
    if (!btnExcel) return;
    const origHtml = btnExcel.innerHTML;
    btnExcel.disabled = true;
    btnExcel.innerHTML = '<span>Loading Excel...</span>';

    try {
      const filename = options.exportFilename || 'validation-export';
      const sheetName = options.sheetName || 'Validation';
      const activeData = tabulator.getData('active');
      await downloadExcel(filename, sheetName, getExportColumns(), activeData);
    } catch (err: any) {
      alert(`Excel export failed: ${err?.message || String(err)}`);
    } finally {
      btnExcel.disabled = false;
      btnExcel.innerHTML = origHtml;
    }
  });

  return {
    tabulator,
    destroy() {
      try {
        tabulator.destroy();
      } catch {
        // Tabulator DOM cleanup
      }
    },
    async setData(newData: any[]) {
      await tabulator.setData(newData);
      const countEl = toolbar.querySelector('.validation-row-count');
      if (countEl) {
        countEl.textContent = `${newData.length.toLocaleString('en-US')} rows`;
      }
    },
    getData() {
      return tabulator.getData();
    },
  };
}
