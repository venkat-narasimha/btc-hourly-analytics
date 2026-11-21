import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Removal Regression Tests (PLAN-tables.md §10)', () => {
  it('asserts zero duckdb, parity, manifest, or playground imports exist in web/src', () => {
    const srcDir = path.resolve(__dirname, '..');
    const forbiddenPatterns = [
      /import.*from.*['"].*duckdb.*['"]/i,
      /import.*from.*['"].*parity.*['"]/i,
      /import.*from.*['"].*manifest.*['"]/i,
      /import.*from.*['"].*playground.*['"]/i,
      /import\(.*['"].*duckdb.*['"]\)/i,
      /import\(.*['"].*parity.*['"]\)/i,
      /import\(.*['"].*manifest.*['"]\)/i,
      /import\(.*['"].*playground.*['"]\)/i,
    ];

    function checkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          checkDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          // Exclude this regression test file itself
          if (entry.name === 'regression.test.ts') continue;

          const content = fs.readFileSync(fullPath, 'utf-8');
          for (const pat of forbiddenPatterns) {
            const match = content.match(pat);
            expect(match, `Forbidden import found in ${fullPath}: ${match?.[0]}`).toBeNull();
          }
        }
      }
    }

    checkDir(srcDir);
  });
});
