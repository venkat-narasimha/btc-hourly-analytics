import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const webRoot = path.resolve(__dirname, '..');
const srcDir = path.resolve(webRoot, 'node_modules/@duckdb/duckdb-wasm/dist');
const destDir = path.resolve(webRoot, 'public/duckdb');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

const assets = [
  'duckdb-eh.wasm',
  'duckdb-browser-eh.worker.js',
];

for (const file of assets) {
  const src = path.join(srcDir, file);
  const dest = path.join(destDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    const sizeMb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(2);
    console.log(`Copied ${file} -> public/duckdb/ (${sizeMb} MB)`);
  } else {
    console.warn(`Warning: DuckDB asset not found at ${src}`);
  }
}
