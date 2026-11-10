import { parse, type Statement } from 'pgsql-ast-parser';
import type { Node, Edge } from '@xyflow/react';
import { buildFlowFromAST, type AstLoc } from './buildFlowFromAST';

/** Opening quote characters (straight or smart) → the straight quote they stand for. */
const QUOTES: Record<string, string> = {
  "'": "'", '"': '"', '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
};

/**
 * Cleans pasted SQL for the parser without changing what it means. Smart quotes around strings and
 * identifiers become straight quotes, an em dash becomes `--` (a comment) and an en dash `-`, and
 * zero-width characters are dropped. String literals, quoted identifiers and comments are kept
 * exactly as written. Some fixes change the text's length, so `editorOffset[i]` records where
 * cleaned character i came from in the editor, keeping node ↔ code highlights aligned.
 * `masked` is the cleaned text with literals and comments blanked, for keyword searches, and
 * `recursiveAt` lists where each `WITH RECURSIVE` keyword starts in the cleaned text.
 */
export function sanitizeInput(raw: string): {
  text: string;
  masked: string;
  editorOffset: number[];
  recursiveAt: number[];
} {
  let text = '';
  let code = ''; // `text` with literals and comments blanked, for keyword searches
  const editorOffset: number[] = [];
  const emit = (out: string, from: number, literal = false) => {
    text += out;
    code += literal ? out.replace(/[^\n]/g, ' ') : out;
    for (let k = 0; k < out.length; k++) editorOffset.push(from);
  };
  const copyLiteral = (from: number, to: number) => {
    for (let k = from; k < to; k++) emit(raw[k], k, true);
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const quote = QUOTES[ch];
    if (quote) {
      // A string or quoted identifier: keep its contents, straighten smart delimiters only.
      const smart = ch !== quote;
      const closers = smart ? (quote === "'" ? "'\u2018\u2019" : '"\u201C\u201D') : quote;
      emit(quote, i, true);
      let j = i + 1;
      for (; j < raw.length; j++) {
        if (!closers.includes(raw[j])) {
          emit(raw[j], j, true);
        } else if (!smart && raw[j + 1] === quote) {
          copyLiteral(j, j + 2); // doubled quote inside the literal
          j++;
        } else {
          break;
        }
      }
      if (j < raw.length) emit(quote, j, true);
      i = j;
      continue;
    }
    const dollar = ch === '$' ? /^\$(?:[A-Za-z_]\w*)?\$/.exec(raw.slice(i, i + 64)) : null;
    if (dollar || raw.startsWith('--', i) || raw.startsWith('/*', i) || ch === '\u2014') {
      // Dollar-quoted string or comment: keep as written. An em dash starts a comment once it's `--`.
      let end: number;
      if (dollar) {
        const close = raw.indexOf(dollar[0], i + dollar[0].length);
        end = close === -1 ? raw.length : close + dollar[0].length;
      } else if (raw.startsWith('/*', i)) {
        const close = raw.indexOf('*/', i + 2);
        end = close === -1 ? raw.length : close + 2;
      } else {
        const eol = raw.indexOf('\n', i);
        end = eol === -1 ? raw.length : eol;
      }
      if (ch === '\u2014') {
        emit('--', i, true);
        copyLiteral(i + 1, end);
      } else {
        copyLiteral(i, end);
      }
      i = end - 1;
      continue;
    }
    if (/[\uFEFF\u200B-\u200D\u2060]/.test(ch)) continue; // BOM, zero-width chars
    emit(ch === '\u2013' ? '-' : ch, i);
  }
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  const recursiveAt = [...code.matchAll(/\bWITH\s+RECURSIVE\b/gi)]
    .map((m) => m.index + m[0].length - 'RECURSIVE'.length - start);
  return {
    text: text.slice(start, end),
    masked: code.slice(start, end),
    editorOffset: editorOffset.slice(start, end),
    recursiveAt,
  };
}

/**
 * pgsql-ast-parser reads `WITH RECURSIVE` only with a column list (`t(n) AS …`); without one it
 * parses a plain `WITH`. So parse the SQL as written first, and if that fails, blank the RECURSIVE
 * keyword (same length, so positions don't move) and try again.
 */
function parseSql(input: string, recursiveAt: number[]): { ast: Statement[]; text: string } {
  try {
    return { ast: parse(input, { locationTracking: true }), text: input };
  } catch (err) {
    if (!recursiveAt.length) throw err;
    let text = input;
    for (const at of recursiveAt) text = text.slice(0, at) + ' '.repeat(9) + text.slice(at + 9);
    try {
      return { ast: parse(text, { locationTracking: true }), text };
    } catch {
      throw err;
    }
  }
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Unknown parse error';
}

function shortenError(msg: string): string {
  const firstLine = msg.split('\n').find((l) => l.trim()) ?? msg;
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine;
}

/** Parses SQL into a diagram. `graph` is null when parsing fails, so the last good diagram stays up. */
export function parseToGraph(raw: string): { graph: { nodes: Node[]; edges: Edge[] } | null; error: string | null } {
  const { text: input, masked, editorOffset, recursiveAt } = sanitizeInput(raw);
  if (!input) return { graph: { nodes: [], edges: [] }, error: null };

  try {
    const { ast, text } = parseSql(input, recursiveAt);
    const graph = buildFlowFromAST(ast, text);
    // Node locations point into the cleaned text; map them back onto the editor's text.
    for (const node of graph.nodes) {
      const loc = node.data.loc as AstLoc | undefined;
      if (loc) node.data.loc = { start: editorOffset[loc.start], end: editorOffset[Math.max(loc.start, loc.end - 1)] + 1 };
    }
    return { graph, error: null };
  } catch (err) {
    return { graph: null, error: parseErrorMessage(masked, err) };
  }
}

const unsupported = (feature: string, hint = '') =>
  `This query uses ${feature}, which is valid PostgreSQL but not supported yet by the parser behind actuallyEXPLAIN, so it can't be visualized.${hint ? ` ${hint}` : ''}`;

/**
 * Valid PostgreSQL that pgsql-ast-parser rejects. A pattern explains a parse error only when the
 * parser stopped inside its match; otherwise the error is somewhere else.
 */
const UNSUPPORTED: { pattern: RegExp; message: string }[] = [
  {
    pattern: /(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)"?[\w$]+"?\s*\([^()]*\)\s*AS\s*(?:NOT\s+)?(?:MATERIALIZED\s*)?\(/gi,
    message: 'Explicit CTE column lists (e.g., CTE_Name (col1, col2)) are not currently supported by our parser. Try aliasing your columns directly inside the SELECT statement instead!',
  },
  {
    pattern: /\bNATURAL\s+(?:(?:LEFT|RIGHT|FULL)\s+(?:OUTER\s+)?|INNER\s+)?JOIN\b/gi,
    message: 'NATURAL JOIN is not currently supported by our parsing engine. Please use an explicit JOIN with an ON or USING clause.',
  },
  {
    pattern: /\bOVER\s+(?!\()[A-Za-z_]\w*|\bWINDOW\s+[A-Za-z_]\w*\s+AS\b/gi,
    message: unsupported('a named window (WINDOW w AS (…) with OVER w)', 'Write the window definition inside OVER (…) instead.'),
  },
  {
    pattern: /\b(?:ROWS|RANGE|GROUPS)\s+(?:BETWEEN|UNBOUNDED|CURRENT\s+ROW|\d+\s+(?:PRECEDING|FOLLOWING))/gi,
    message: unsupported('a window frame (ROWS / RANGE / GROUPS …)'),
  },
  { pattern: /\bGROUPING\s+SETS\b/gi, message: unsupported('GROUPING SETS', 'ROLLUP and CUBE are supported.') },
  { pattern: /\bIS\s+(?:NOT\s+)?DISTINCT\s+FROM\b/gi, message: unsupported('IS [NOT] DISTINCT FROM') },
  { pattern: /\b(?:INTERSECT|EXCEPT)\b/gi, message: unsupported('INTERSECT or EXCEPT', 'Try rewriting it with EXISTS / NOT EXISTS.') },
  { pattern: /\bWITH\s+TIES\b/gi, message: unsupported('FETCH … WITH TIES') },
];

/** Where a parse error happened, as an offset into the parsed text (from "line L col C"). */
function errorOffset(text: string, err: unknown): number | null {
  const m = /line (\d+) col (\d+)/.exec(extractErrorMessage(err));
  if (!m) return null;
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < Number(m[1]) - 1 && i < lines.length; i++) offset += lines[i].length + 1;
  return offset + Number(m[2]) - 1;
}

/** `masked` is the parsed text with literals and comments blanked, so keywords inside them don't count. */
function parseErrorMessage(masked: string, err: unknown): string {
  if (/^\s*(GRANT|REVOKE)\b/i.test(masked)) {
    return 'Data Control Language (DCL) statements like GRANT and REVOKE are not currently supported for visualization. Try visualizing a SELECT, INSERT, or CREATE statement instead!';
  } else if (/^\s*(CREATE|DROP)\s+(ROLE|USER)\b/i.test(masked)) {
    return 'Administrative commands (like CREATE ROLE or CREATE USER) are not currently supported for visualization. Try visualizing a table definition or data query instead!';
  } else if (/^\s*EXPLAIN\b/i.test(masked)) {
    return 'actuallyEXPLAIN visualizes the logical intent of raw SQL, not physical database execution plans. Please remove the EXPLAIN keyword and any text output, and just paste your raw query!';
  }
  const at = errorOffset(masked, err);
  if (at !== null) {
    for (const { pattern, message } of UNSUPPORTED) {
      for (const m of masked.matchAll(pattern)) {
        if (at >= m.index && at <= m.index + m[0].length + 2) return message;
      }
    }
  }
  const message = extractErrorMessage(err);
  console.warn('[SQL Parse Error]', message);
  return shortenError(message);
}
