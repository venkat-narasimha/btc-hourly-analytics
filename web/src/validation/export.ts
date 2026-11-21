/**
 * Client-side table and instance export utilities.
 * - CSV: native lightweight RFC4180 export
 * - Excel: dynamically imports SheetJS `xlsx` ONLY on click (lazy chunk)
 */

export interface ExportColumn {
  title: string;
  field: string;
  formatter?: (val: any) => string;
}

/**
 * Escapes a cell value for RFC4180 CSV export.
 */
function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates and triggers download of a CSV file.
 */
export function downloadCsv(filename: string, columns: ExportColumn[], rows: Record<string, any>[]): void {
  const header = columns.map((c) => escapeCsvCell(c.title)).join(',');
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const rawVal = r[c.field];
        const formatted = c.formatter ? c.formatter(rawVal) : rawVal;
        return escapeCsvCell(formatted);
      })
      .join(',')
  );

  const csvContent = '\uFEFF' + [header, ...lines].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Dynamically imports SheetJS `xlsx` on click and triggers XLSX download.
 * Ensures initial bundle size is 100% unaffected.
 */
export async function downloadExcel(
  filename: string,
  sheetName: string,
  columns: ExportColumn[],
  rows: Record<string, any>[]
): Promise<void> {
  // Dynamic import of SheetJS xlsx
  const XLSX = await import('xlsx');

  // Format rows according to columns
  const formattedRows = rows.map((r) => {
    const rowObj: Record<string, any> = {};
    for (const c of columns) {
      const rawVal = r[c.field];
      rowObj[c.title] = c.formatter ? c.formatter(rawVal) : rawVal;
    }
    return rowObj;
  });

  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31));

  const cleanName = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, cleanName);
}
