/**
 * SQL Validator for Verification Playground console.
 * Strictly enforces a read-only allowlist:
 * - Statements must start with SELECT or WITH after comment stripping.
 * - Rejects any DDL, DML, administrative commands, or multiple statements.
 */

const FORBIDDEN_KEYWORDS = [
  'ATTACH',
  'COPY',
  'INSTALL',
  'LOAD',
  'PRAGMA',
  'SET',
  'CREATE',
  'DROP',
  'INSERT',
  'UPDATE',
  'DELETE',
  'ALTER',
  'EXPORT',
  'IMPORT',
  'CALL',
  'EXECUTE',
  'PREPARE',
  'DEALLOCATE',
  'VACUUM',
  'CHECKPOINT',
] as const;

export interface SqlValidationResult {
  valid: boolean;
  error?: string;
  sanitizedSql?: string;
}

/**
 * Strips SQL line comments (--...) and block comments (/*...*\/)
 * while preserving string literals ('...').
 */
export function stripComments(sql: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let out = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++; // skip /
      }
      continue;
    }

    if (inSingleQuote) {
      out += ch;
      if (ch === "'") {
        if (next === "'") {
          // Escaped single quote ('')
          out += next;
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    if (inDoubleQuote) {
      out += ch;
      if (ch === '"') {
        if (next === '"') {
          // Escaped double quote ("")
          out += next;
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }

    // Check for comment starts
    if (ch === '-' && next === '-') {
      inLineComment = true;
      i++; // skip second -
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++; // skip *
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      out += ch;
      continue;
    }

    if (ch === '"') {
      inDoubleQuote = true;
      out += ch;
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Validates that an SQL query complies with read-only SELECT / WITH allowlist rules.
 */
export function validateSql(rawSql: string): SqlValidationResult {
  if (!rawSql || typeof rawSql !== 'string') {
    return { valid: false, error: 'SQL query cannot be empty.' };
  }

  const stripped = stripComments(rawSql).trim();
  if (!stripped) {
    return { valid: false, error: 'SQL query cannot be empty.' };
  }

  // Reject multiple statements separated by semicolons (ignoring trailing semicolon)
  // Check for semicolon outside quotes
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (inQuote) {
      if (c === quoteChar) {
        if (i + 1 < stripped.length && stripped[i + 1] === quoteChar) {
          i++; // skip escaped quote
        } else {
          inQuote = false;
        }
      }
    } else {
      if (c === "'" || c === '"') {
        inQuote = true;
        quoteChar = c;
      } else if (c === ';') {
        // Check if there is any non-whitespace content after this semicolon
        const rest = stripped.substring(i + 1).trim();
        if (rest.length > 0) {
          return { valid: false, error: 'Multiple statements are not permitted.' };
        }
      }
    }
  }

  // Remove optional trailing semicolon for keyword checking
  const singleStatement = stripped.replace(/;+\s*$/, '').trim();

  // Must begin with SELECT or WITH
  const matchStart = singleStatement.match(/^([a-zA-Z]+)/);
  if (!matchStart) {
    return { valid: false, error: 'Statement must begin with SELECT or WITH.' };
  }

  const initialKeyword = matchStart[1].toUpperCase();
  if (initialKeyword !== 'SELECT' && initialKeyword !== 'WITH') {
    return {
      valid: false,
      error: `Forbidden statement type '${initialKeyword}'. Only SELECT or WITH statements are allowed.`,
    };
  }

  // Scan token words outside quotes to ensure no forbidden DDL/DML/admin keywords are used
  // Tokenize ignoring contents of quotes
  let token = '';
  let inTokenQuote = false;
  let tokenQuoteChar = '';

  for (let i = 0; i < singleStatement.length; i++) {
    const ch = singleStatement[i];
    if (inTokenQuote) {
      if (ch === tokenQuoteChar) {
        if (i + 1 < singleStatement.length && singleStatement[i + 1] === tokenQuoteChar) {
          i++;
        } else {
          inTokenQuote = false;
        }
      }
    } else {
      if (ch === "'" || ch === '"') {
        inTokenQuote = true;
        tokenQuoteChar = ch;
        token = '';
      } else if (/[a-zA-Z0-9_]/.test(ch)) {
        token += ch;
      } else {
        if (token) {
          const upperToken = token.toUpperCase();
          if ((FORBIDDEN_KEYWORDS as readonly string[]).includes(upperToken)) {
            return {
              valid: false,
              error: `Forbidden keyword '${upperToken}' detected. Only read-only queries are permitted.`,
            };
          }
          token = '';
        }
      }
    }
  }

  if (token) {
    const upperToken = token.toUpperCase();
    if ((FORBIDDEN_KEYWORDS as readonly string[]).includes(upperToken)) {
      return {
        valid: false,
        error: `Forbidden keyword '${upperToken}' detected. Only read-only queries are permitted.`,
      };
    }
  }

  return { valid: true, sanitizedSql: singleStatement };
}
