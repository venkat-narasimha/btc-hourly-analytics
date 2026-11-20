/**
 * DuckDB-WASM execution engine for Verification Playground.
 * Lazily loads self-hosted EH wasm bundle and runs queries in a dedicated Web Worker.
 *
 * Rules:
 * - Zero external runtime requests: EH wasm and worker are loaded from /duckdb/
 * - Singleton lazy init: DuckDB is only imported/initialized on first verify/playground action
 * - 10-second query timeout guard (terminates worker + re-inits on timeout)
 * - Automatic re-init if meta.release_id differs
 * - Errors surfaced verbatim
 */

import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

export interface DuckDBState {
  db: AsyncDuckDB | null;
  conn: AsyncDuckDBConnection | null;
  worker: Worker | null;
  releaseId: string | null;
  initialized: boolean;
  initPromise: Promise<AsyncDuckDBConnection> | null;
}

const state: DuckDBState = {
  db: null,
  conn: null,
  worker: null,
  releaseId: null,
  initialized: false,
  initPromise: null,
};

export function isDuckDBLoaded(): boolean {
  return state.initialized && state.conn !== null;
}

export function getCurrentReleaseId(): string | null {
  return state.releaseId;
}

/**
 * Terminates the worker and cleans up DuckDB state.
 */
export async function terminateDuckDB(): Promise<void> {
  if (state.conn) {
    try {
      await state.conn.close();
    } catch {
      // Ignore close errors during termination
    }
    state.conn = null;
  }
  if (state.db) {
    try {
      await state.db.terminate();
    } catch {
      // Ignore termination errors
    }
    state.db = null;
  }
  if (state.worker) {
    try {
      state.worker.terminate();
    } catch {
      // Ignore worker termination errors
    }
    state.worker = null;
  }
  state.initialized = false;
  state.initPromise = null;
  state.releaseId = null;
}

/**
 * Initializes the DuckDB-WASM engine.
 * Dynamically imports @duckdb/duckdb-wasm to keep main chunk lean.
 */
export async function initDuckDB(releaseId?: string): Promise<AsyncDuckDBConnection> {
  // If already initialized and release_id matches, return existing connection
  if (state.initialized && state.conn) {
    if (releaseId && state.releaseId && state.releaseId !== releaseId) {
      await terminateDuckDB();
    } else {
      return state.conn;
    }
  }

  // If initialization is in progress, wait for it
  if (state.initPromise) {
    return state.initPromise;
  }

  state.initPromise = (async () => {
    try {
      if (typeof window === 'undefined' || typeof Worker === 'undefined') {
        throw new Error('DuckDB-WASM requires a browser environment with Web Worker support.');
      }

      // Dynamic import to keep main bundle lean
      const duckdb = await import('@duckdb/duckdb-wasm');

      // Create Web Worker using self-hosted asset
      const workerUrl = new URL('/duckdb/duckdb-browser-eh.worker.js', window.location.origin).toString();
      const wasmUrl = new URL('/duckdb/duckdb-eh.wasm', window.location.origin).toString();

      const worker = new Worker(workerUrl);
      const logger = new duckdb.VoidLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);

      await db.instantiate(wasmUrl);
      await db.open({
        query: {
          castBigIntToDouble: true,
          castTimestampToDate: true,
          castDecimalToDouble: true,
        },
      });

      // Fetch the release parquet artifact
      const parquetUrl = '/data/current/btcusdt_1h.parquet';
      const response = await fetch(parquetUrl, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`Failed to fetch Parquet release artifact: HTTP ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Register parquet buffer and create klines view
      await db.registerFileBuffer('klines.parquet', bytes);

      const conn = await db.connect();
      await conn.query(`CREATE VIEW klines AS SELECT * FROM parquet_scan('klines.parquet');`);

      state.db = db;
      state.conn = conn;
      state.worker = worker;
      state.releaseId = releaseId ?? null;
      state.initialized = true;

      return conn;
    } catch (err) {
      await terminateDuckDB();
      throw err;
    } finally {
      state.initPromise = null;
    }
  })();

  return state.initPromise;
}

/**
 * Converts Apache Arrow Table into an array of plain JavaScript objects.
 */
export function arrowTableToObjects(table: any): Array<Record<string, any>> {
  if (!table) return [];

  try {
    if (typeof table.toArray === 'function') {
      const records = table.toArray();
      return records.map((r: any) => {
        const obj = typeof r.toJSON === 'function' ? r.toJSON() : { ...r };
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'bigint') {
            obj[k] = Number(v);
          }
        }
        return obj;
      });
    }
  } catch {
    // Fall back to columnar iteration if toArray fails
  }

  const rows: Array<Record<string, any>> = [];
  const fields: string[] = table.schema?.fields?.map((f: any) => f.name) ?? [];
  const numRows: number = table.numRows ?? 0;

  for (let i = 0; i < numRows; i++) {
    const row: Record<string, any> = {};
    for (const name of fields) {
      const col = typeof table.getChild === 'function' ? table.getChild(name) : null;
      let val = col ? col.get(i) : null;
      if (typeof val === 'bigint') {
        val = Number(val);
      }
      row[name] = val;
    }
    rows.push(row);
  }

  return rows;
}

export interface QueryResult {
  rows: Array<Record<string, any>>;
  rowCount: number;
  columns: string[];
  durationMs: number;
  truncated: boolean;
}

/**
 * Executes a read-only SQL query against the DuckDB instance with a 10s timeout guard.
 */
export async function executeQuery(
  sql: string,
  options?: {
    releaseId?: string;
    timeoutMs?: number;
    maxRows?: number;
  }
): Promise<QueryResult> {
  const timeoutMs = options?.timeoutMs ?? 10000;
  const maxRows = options?.maxRows ?? 500;

  const conn = await initDuckDB(options?.releaseId);

  const startTime = performance.now();

  let timerId: any = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(async () => {
      // Terminate worker immediately on timeout guard trigger
      await terminateDuckDB();
      reject(new Error(`Query execution timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    const queryPromise = conn.query(sql);
    const table = await Promise.race([queryPromise, timeoutPromise]);
    const durationMs = performance.now() - startTime;

    const allRows = arrowTableToObjects(table);
    const totalCount = allRows.length;
    const truncated = totalCount > maxRows;
    const rows = truncated ? allRows.slice(0, maxRows) : allRows;

    const columns = table.schema?.fields?.map((f: any) => f.name) ?? (rows[0] ? Object.keys(rows[0]) : []);

    return {
      rows,
      rowCount: totalCount,
      columns,
      durationMs,
      truncated,
    };
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }
}
