import { describe, it, expect } from 'vitest';
import { stripComments, validateSql } from './sql_validator';

describe('sql_validator', () => {
  describe('stripComments', () => {
    it('strips line comments', () => {
      const sql = '-- this is a comment\nSELECT * FROM klines;';
      expect(stripComments(sql).trim()).toBe('SELECT * FROM klines;');
    });

    it('strips block comments', () => {
      const sql = '/* block comment */ SELECT 1 /* inside */ FROM klines;';
      expect(stripComments(sql).replace(/\s+/g, ' ').trim()).toBe('SELECT 1 FROM klines;');
    });

    it('preserves comment markers inside quotes', () => {
      const sql = "SELECT '-- not a comment', '/* also not */' FROM klines;";
      expect(stripComments(sql).trim()).toBe("SELECT '-- not a comment', '/* also not */' FROM klines;");
    });
  });

  describe('validateSql', () => {
    it('accepts standard SELECT queries', () => {
      const res = validateSql('SELECT count(*) FROM klines');
      expect(res.valid).toBe(true);
      expect(res.sanitizedSql).toBe('SELECT count(*) FROM klines');
    });

    it('accepts CTE queries starting with WITH', () => {
      const sql = 'WITH cte AS (SELECT 1 AS val) SELECT val FROM cte';
      const res = validateSql(sql);
      expect(res.valid).toBe(true);
      expect(res.sanitizedSql).toBe(sql);
    });

    it('accepts queries with trailing semicolon and surrounding whitespace', () => {
      const res = validateSql('   \n SELECT close FROM klines;   \n');
      expect(res.valid).toBe(true);
      expect(res.sanitizedSql).toBe('SELECT close FROM klines');
    });

    it('accepts queries with comments preceding SELECT', () => {
      const sql = '-- Verify bars\n/* Multi-line comment */\nSELECT COUNT(*) FROM klines;';
      const res = validateSql(sql);
      expect(res.valid).toBe(true);
    });

    it('accepts keywords when they appear inside string literals', () => {
      const sql = "SELECT 'DROP TABLE klines' AS note, 'CREATE' AS op FROM klines";
      const res = validateSql(sql);
      expect(res.valid).toBe(true);
    });

    it('rejects empty or whitespace-only queries', () => {
      expect(validateSql('').valid).toBe(false);
      expect(validateSql('   \n\t  ').valid).toBe(false);
      expect(validateSql('-- just a comment').valid).toBe(false);
    });

    it('rejects non-SELECT/WITH statements', () => {
      const forbiddenStarts = [
        'INSERT INTO klines VALUES (1)',
        'UPDATE klines SET close = 100',
        'DELETE FROM klines',
        'DROP TABLE klines',
        'CREATE TABLE test (x INT)',
        'ALTER TABLE klines ADD COLUMN fake INT',
        'PRAGMA version',
        'SET threads = 4',
        'ATTACH "some.db"',
        'COPY klines TO "out.csv"',
        'INSTALL httpfs',
        'LOAD httpfs',
        'EXPORT DATABASE "out"',
        'IMPORT DATABASE "in"',
        'SHOW TABLES',
        'VACUUM',
      ];

      for (const cmd of forbiddenStarts) {
        const res = validateSql(cmd);
        expect(res.valid).toBe(false);
      }
    });

    it('rejects multiple statements separated by semicolon', () => {
      const malicious = 'SELECT 1 FROM klines; DROP TABLE klines;';
      const res = validateSql(malicious);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Multiple statements');
    });

    it('rejects forbidden keywords embedded in subqueries or clauses', () => {
      const queries = [
        'SELECT 1; ATTACH DATABASE "foo"',
        'WITH bad AS (DROP TABLE klines) SELECT * FROM bad',
        'SELECT * FROM klines WHERE close IN (CREATE TABLE foo (a INT))',
        'SELECT * FROM klines; COPY klines TO "foo"',
      ];

      for (const q of queries) {
        const res = validateSql(q);
        expect(res.valid).toBe(false);
      }
    });
  });
});
