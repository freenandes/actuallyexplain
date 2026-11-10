import type React from 'react';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import dagre from 'dagre';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AST = Record<string, any>;

const NODE_WIDTH = 240;
const MIN_NODE_HEIGHT = 80;
const NODE_SEP = 40; // horizontal gap between nodes in a rank
const RANK_SEP = 120; // vertical gap between ranks

const nodeColors: Record<string, string> = {
  table: '#879A39',
  insert_target: '#879A39',
  join: '#3AA99F',
  where: '#D0A215',
  select: '#4385BE',
  orderby: '#8B7EC8',
  groupby: '#CE5D97',
  having: '#D0A215',
  update: '#DA702C',
  set: '#D0A215',
  insert: '#DA702C',
  values: '#8B7EC8',
  delete: '#D14D41',
  create: '#879A39',
  column: '#9F9D96',
  drop: '#D14D41',
  alter: '#D0A215',
  action: '#8B7EC8',
  operation: '#4385BE',
  cte: '#3AA99F',
  limit: '#9F9D96',
  returning: '#CE5D97',
  union: '#8B7EC8',
};


function estimateNodeHeight(_label: string, plainEnglish: string): number {
  const BODY_CPL = 28;
  const HEADER_H = 40;

  const bodyLines = Math.max(1, Math.ceil(plainEnglish.length / BODY_CPL));
  const bodyH = bodyLines * 16 + 12;

  return Math.max(MIN_NODE_HEIGHT, HEADER_H + bodyH + 4);
}

// ── Expression → readable string ──

// The AST doesn't keep parentheses, so they're added back wherever an operand binds more
// loosely than its operator. Levels follow pgsql-ast-parser's grammar (syntax/expr.ne).
const ATOM = 16; // refs, literals, calls, casts…: never need parentheses
const PARENTHESISED = 17; // lists and subqueries already render inside parentheses

function precedence(e: any): number {
  switch (e?.type) {
    case 'binary':
      switch (e.op) {
        case 'OR': return 1;
        case 'AND': return 2;
        case '=': case '!=': return 4;
        case '|': case '&': case '#': return 8;
        case 'LIKE': case 'NOT LIKE': case 'ILIKE': case 'NOT ILIKE': return 9;
        case 'IN': case 'NOT IN': return 10;
        case '+': case '-': case '||': case '#-': case '&&': return 11;
        case '*': case '/': case '%': return 12;
        case '^': return 13;
        case 'AT TIME ZONE': return 15;
        default: return 6; // <, >, <=, >=, @>, <@, ~, @@, …
      }
    case 'unary':
      return e.op === 'NOT' ? 3 : /^IS /.test(e.op) ? 5 : 14; // 5: IS NULL, IS TRUE, …; 14: prefix + and -
    case 'ternary':
      return 7; // [NOT] BETWEEN
    case 'list':
    case 'select':
      return PARENTHESISED;
    default:
      return ATOM;
  }
}

/** Renders an operand, in parentheses if it binds more loosely than `min`. */
function operandToString(e: any, min: number, depth: number): string {
  const s = exprToString(e, depth + 1);
  return precedence(e) < min ? `(${s})` : s;
}

function exprToString(e: any, depth = 0): string {
  if (depth > 5) return '…';
  if (e == null) return '';
  if (typeof e === 'string') return e;
  if (typeof e === 'number') return String(e);
  if (typeof e === 'boolean') return String(e);

  switch (e.type) {
    case 'ref': {
      const tbl = e.table?.name ? `${e.table.name}.` : '';
      return `${tbl}${e.name}`;
    }
    case 'binary': {
      const p = precedence(e);
      // Every level is left-associative, so a right operand at the same level needs parentheses.
      // IN's operand always has them, even around a single value: status IN ('active').
      const rightMin = e.op === 'IN' || e.op === 'NOT IN' ? PARENTHESISED : p + 1;
      return `${operandToString(e.left, p, depth)} ${e.op} ${operandToString(e.right, rightMin, depth)}`;
    }
    case 'unary': {
      // pgsql-ast-parser's IS NULL / IS NOT NULL / IS [NOT] TRUE / IS [NOT] FALSE are postfix;
      // NOT, - and + are prefix.
      const operand = operandToString(e.operand, precedence(e), depth);
      return /^IS /.test(e.op) ? `${operand} ${e.op}` : `${e.op} ${operand}`;
    }
    case 'integer':
    case 'numeric':
      return String(e.value);
    case 'string':
      return `'${e.value}'`;
    case 'boolean':
      return String(e.value);
    case 'null':
      return 'NULL';
    case 'parameter':
      return `$${e.name ?? '?'}`;
    case 'call': {
      const fname = e.function?.name ?? '?';
      const args = (e.args ?? []).map((a: any) => exprToString(a, depth + 1)).join(', ');
      return `${fname}(${args})`;
    }
    case 'cast':
      return `CAST(${exprToString(e.operand, depth + 1)} AS ${e.to?.name ?? '?'})`;
    case 'member':
      return `${exprToString(e.operand, depth + 1)}.${e.member}`;
    case 'arrayIndex':
      return `${exprToString(e.array, depth + 1)}[${exprToString(e.index, depth + 1)}]`;
    case 'list':
    case 'array': {
      const items = (e.expressions ?? []).map((x: any) => exprToString(x, depth + 1));
      return `(${items.join(', ')})`;
    }
    case 'case':
      return 'CASE…END';
    case 'ternary': {
      const p = precedence(e);
      return `${operandToString(e.value, p, depth)} ${e.op} ${operandToString(e.lo, p, depth)} AND ${operandToString(e.hi, p + 1, depth)}`;
    }
    case 'select': {
      const subCols = (e.columns ?? [])
        .map((c: any) => exprToString(c.expr, depth + 1))
        .join(', ');
      const subFrom = (e.from ?? [])
        .map((f: any) => tblName(f))
        .join(', ');
      let summary = `SELECT ${subCols || '*'}`;
      if (subFrom) summary += ` FROM ${subFrom}`;
      return `(${summary})`;
    }
    case 'values':
      return '(values)';
    case 'constant':
      return String(e.value ?? '?');
    case 'keyword':
      return String(e.keyword ?? e.value ?? '');
    default:
      break;
  }

  if (e.value !== undefined) return String(e.value);
  if (e.name !== undefined) return String(e.name);
  return '(…)';
}

function tblName(t: any): string {
  if (!t) return '?';
  if (typeof t === 'string') return t;
  if (t.name) {
    if (typeof t.name === 'string') return t.name;
    if (t.name.name) return t.name.name;
  }
  if (t.alias) return t.alias;
  return '?';
}

function tblAlias(t: any): string {
  if (!t) return '';
  const name = t.name ?? t;
  if (name?.alias) return ` (${name.alias})`;
  return '';
}

// ── AST location helpers ──

function astLoc(node: any): AstLoc | undefined {
  return node?._location ?? undefined;
}

function spanLoc(items: any[]): AstLoc | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    const l = item?._location;
    if (l) {
      if (l.start < min) min = l.start;
      if (l.end > max) max = l.end;
    }
  }
  return min <= max ? { start: min, end: max } : undefined;
}

// ── Plain English translation ──

function generatePlainEnglish(kind: string, label: string): string {
  switch (kind) {
    case 'table': {
      if (label === '(no source)') return 'No data source specified.';
      if (label.startsWith('subquery')) return 'Loads data from an inline subquery.';
      return `Loads base data from the ${label} table.`;
    }
    case 'insert_target':
      return 'Target table receiving the inserted rows.';
    case 'where': {
      const cond = label.replace(/^WHERE\s+/i, '');
      return `Keeps only rows where ${cond}.`;
    }
    case 'having': {
      const cond = label.replace(/^HAVING\s+/i, '');
      return `Keeps only groups where ${cond}.`;
    }
    case 'join': {
      if (label.includes('NATURAL')) return 'NATURAL JOIN: Implicitly joins tables using all columns with matching names.';
      if (label.includes('CROSS')) return 'Combines every row with every other row.';
      const onMatch = label.match(/ON\s+(.+)/i);
      const joinType = label.match(/^(\w+\s+JOIN)/i)?.[1] ?? 'JOIN';
      return onMatch
        ? `${joinType}: matches where ${onMatch[1]}.`
        : 'Joins with another data source.';
    }
    case 'select':
      return 'Selects and formats the output columns.';
    case 'groupby': {
      const cols = label.replace(/^GROUP BY\s+/i, '');
      return `Groups rows together by ${cols}.`;
    }
    case 'orderby': {
      const cols = label.replace(/^ORDER BY\s+/i, '');
      return `Sorts the results by ${cols}.`;
    }
    case 'limit': {
      const val = label.replace(/^LIMIT\s+/i, '');
      return `Limits output to ${val} rows.`;
    }
    case 'cte': {
      const name = label.replace(/^(CTE|RECURSIVE):\s*/i, '');
      return label.startsWith('RECURSIVE')
        ? 'Creates a temporary, looping result set. It runs the base query once, then continuously feeds those results back into itself to find deeper matches until no new rows are found.'
        : `Creates a temporary result set named ${name}.`;
    }
    case 'union':
      return label.includes('ALL')
        ? 'Combines all results, keeping duplicates.'
        : 'Combines results, removing duplicates.';
    case 'delete': {
      const table = label.replace(/^DELETE FROM\s+/i, '');
      return `Deletes matched rows from ${table}.`;
    }
    case 'insert':
      return 'Inserts the processed rows into the target.';
    case 'update': {
      const table = label.replace(/^UPDATE\s+/i, '');
      return `Updates matched rows in ${table}.`;
    }
    case 'values':
      return 'Provides literal data values as input.';
    case 'set': {
      const assignments = label.replace(/^SET\s+/i, '');
      return `Sets ${assignments}.`;
    }
    case 'returning': {
      const cols = label.replace(/^RETURNING\s+/i, '');
      return `Returns ${cols} from modified rows.`;
    }
    case 'create': {
      const name = label.replace(/^CREATE TABLE\s+/i, '');
      return `Creates a new table named ${name}.`;
    }
    case 'column':
      return `Defines the ${label.trim()} column.`;
    default:
      return `Performs a ${label || kind} operation.`;
  }
}

// ── Graph builder (coordinates-free, dagre computes layout) ──

interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
}

export interface AstLoc {
  start: number;
  end: number;
}

interface RawNode {
  id: string;
  label: string;
  kind: string;
  loc?: AstLoc;
}

interface RawEdge {
  source: string;
  target: string;
  kind: string;
  isRecursive?: boolean;
}

interface RecursiveSelfRef {
  selfName: string;
  entryNodeId: string | null;
}

class GraphBuilder {
  private nodes: RawNode[] = [];
  private edges: RawEdge[] = [];
  private idCounter = 0;
  private sql: string;

  constructor(sql: string) {
    this.sql = sql;
  }

  addNode(label: string, kind: string, loc?: AstLoc): string {
    const id = `n-${this.idCounter++}`;
    this.nodes.push({ id, label, kind, loc: this.closeParens(loc) });
    return id;
  }

  /** Extend a location backwards to include a SQL keyword (e.g. WHERE, SELECT). */
  kwLoc(loc: AstLoc | undefined, keyword: string): AstLoc | undefined {
    if (!loc) return undefined;
    const kw = keyword.toUpperCase();
    const searchStart = Math.max(0, loc.start - kw.length - 20);
    const prefix = this.sql.substring(searchStart, loc.start).toUpperCase();
    const idx = prefix.lastIndexOf(kw);
    if (idx >= 0) return { start: searchStart + idx, end: loc.end };
    return loc;
  }

  /** Extend a location forward to include a table alias (e.g. users → users u). */
  alLoc(loc: AstLoc | undefined, alias: string | undefined): AstLoc | undefined {
    if (!loc || !alias) return loc;
    const searchEnd = Math.min(loc.end + alias.length + 10, this.sql.length);
    const after = this.sql.substring(loc.end, searchEnd);
    const idx = after.indexOf(alias);
    if (idx >= 0) return { start: loc.start, end: loc.end + idx + alias.length };
    return loc;
  }

  /**
   * pgsql-ast-parser leaves parentheses out of its locations, so a range ending in a bracketed part
   * (`x IN (1, 2)`, `(a OR b)`) stops before the `)`. Extend it over the `)` of every `(` it leaves
   * open, ignoring brackets inside quotes and comments.
   */
  closeParens(loc: AstLoc | undefined): AstLoc | undefined {
    if (!loc) return loc;
    const { sql } = this;
    let open = 0;
    for (let i = loc.start; i < loc.end; i++) {
      const ch = sql[i];
      if (ch === "'" || ch === '"') {
        const close = sql.indexOf(ch, i + 1); // skip a quoted string or identifier
        i = close === -1 ? loc.end : close;
      } else if (sql.startsWith('--', i)) {
        const eol = sql.indexOf('\n', i); // skip a line comment
        i = eol === -1 ? loc.end : eol;
      } else if (sql.startsWith('/*', i)) {
        const close = sql.indexOf('*/', i + 2); // skip a block comment
        i = close === -1 ? loc.end : close + 1;
      } else if (ch === '(') {
        open++;
      } else if (ch === ')' && open > 0) {
        open--;
      }
    }
    let end = loc.end;
    for (; open > 0; open--) {
      const m = /^\s*\)/.exec(sql.slice(end));
      if (!m) break;
      end += m[0].length;
    }
    return { start: loc.start, end };
  }

  addEdge(source: string, target: string, kind?: string, isRecursive?: boolean) {
    this.edges.push({ source, target, kind: kind ?? 'select', isRecursive });
  }

  layout(): FlowGraph {
    if (this.nodes.length === 0) return { nodes: [], edges: [] };

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 40, marginy: 40 });
    g.setDefaultEdgeLabel(() => ({}));

    const nodeExtras = new Map<string, { plainEnglish: string; height: number }>();
    for (const n of this.nodes) {
      const plainEnglish = generatePlainEnglish(n.kind, n.label);
      const height = estimateNodeHeight(n.label, plainEnglish);
      nodeExtras.set(n.id, { plainEnglish, height });
      g.setNode(n.id, { width: NODE_WIDTH, height });
    }
    for (const e of this.edges) {
      if (!e.isRecursive) {
        g.setEdge(e.source, e.target);
      }
    }

    dagre.layout(g);

    const maxRightX = Math.max(
      ...this.nodes.map((n) => g.node(n.id).x + NODE_WIDTH / 2),
    );

    // Top and bottom of a node's rank. dagre centres every node of a rank on the same y and leaves
    // RANK_SEP between ranks, so recursive loops can run through those gaps without crossing nodes.
    const rankEdges = (id: string) => {
      const { y } = g.node(id);
      const half = Math.max(...this.nodes
        .filter((n) => Math.abs(g.node(n.id).y - y) < 1)
        .map((n) => nodeExtras.get(n.id)!.height / 2));
      return { top: y - half, bottom: y + half };
    };

    const flowNodes: Node[] = this.nodes.map((n) => {
      const pos = g.node(n.id);
      const color = nodeColors[n.kind] ?? '#58a6ff';
      const extra = nodeExtras.get(n.id)!;
      return {
        id: n.id,
        type: 'sql',
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - extra.height / 2 },
        data: {
          label: n.label,
          loc: n.loc,
          kind: n.kind,
          plainEnglish: extra.plainEnglish,
        },
        style: {
          '--node-color': color,
          width: NODE_WIDTH,
        } as React.CSSProperties,
      };
    });

    const arrow = {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
    };

    let loopCount = 0;
    const flowEdges: Edge[] = this.edges.map((e, i) => {
      const color = nodeColors[e.kind] ?? '#4385BE';
      if (e.isRecursive) {
        const srcPos = g.node(e.source);
        const tgtPos = g.node(e.target);
        // Out of the CTE's right side, up through the gap above its rank, around the right of the
        // graph, back in through the gap below the target's rank, and into the target's right side.
        const fromX = srcPos.x + NODE_WIDTH / 2;
        const toX = tgtPos.x + NODE_WIDTH / 2;
        const side = NODE_SEP / 2; // between a node and its right-hand neighbour
        const lane = loopCount++; // each loop gets its own lane, nesting outside the previous ones
        const exitY = rankEdges(e.source).top - RANK_SEP / 2 + 12 * lane;
        const entryY = rankEdges(e.target).bottom + RANK_SEP / 2 - 12 * lane;
        const loopX = maxRightX + 80 + 24 * lane;
        return {
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          type: 'recursive',
          animated: true,
          markerEnd: { ...arrow, color: '#3AA99F' },
          data: {
            points: [
              { x: fromX, y: srcPos.y },
              { x: fromX + side, y: srcPos.y },
              { x: fromX + side, y: exitY },
              { x: loopX, y: exitY },
              { x: loopX, y: entryY },
              { x: toX + side, y: entryY },
              { x: toX + side, y: tgtPos.y },
              { x: toX, y: tgtPos.y },
            ],
          },
          style: {
            stroke: '#3AA99F',
            strokeDasharray: '6 6',
            strokeWidth: 2,
          },
        };
      }
      return {
        id: `e-${i}`,
        source: e.source,
        target: e.target,
        animated: true,
        markerEnd: { ...arrow, color },
        style: {
          stroke: color,
          strokeDasharray: '6 6',
          strokeWidth: 2,
        },
      };
    });

    return { nodes: flowNodes, edges: flowEdges };
  }
}

// ── Recursively find CTE references inside any expression (subqueries in WHERE, HAVING, etc.) ──

function collectCteRefsInExpr(
  expr: any,
  cteMap: Map<string, string>,
  found: Set<string>,
) {
  if (!expr || typeof expr !== 'object') return;

  // A nested SELECT — check its FROM for CTE references
  if (expr.type === 'select' && expr.from) {
    for (const src of expr.from) {
      if (src.type === 'table') {
        const name = tblName(src);
        const cteRef = cteMap.get(name);
        if (cteRef) found.add(cteRef);
      }
      // Also recurse into join ON clauses
      if (src.join?.on) collectCteRefsInExpr(src.join.on, cteMap, found);
    }
    // Recurse into the subquery's own WHERE / HAVING
    if (expr.where) collectCteRefsInExpr(expr.where, cteMap, found);
    if (expr.having) collectCteRefsInExpr(expr.having, cteMap, found);
    return;
  }

  // Walk all object values recursively
  for (const val of Object.values(expr)) {
    if (Array.isArray(val)) {
      for (const item of val) collectCteRefsInExpr(item, cteMap, found);
    } else if (val && typeof val === 'object') {
      collectCteRefsInExpr(val, cteMap, found);
    }
  }
}

function linkCteRefsToNode(
  expr: any,
  cteMap: Map<string, string>,
  targetNodeId: string,
  g: GraphBuilder,
) {
  if (cteMap.size === 0) return;
  const refs = new Set<string>();
  collectCteRefsInExpr(expr, cteMap, refs);
  for (const cteNodeId of refs) {
    g.addEdge(cteNodeId, targetNodeId, 'cte');
  }
}

// ── Recursively find & build subquery sub-graphs inside any expression ──

function buildSubqueriesInExpr(
  expr: any,
  g: GraphBuilder,
  cteMap: Map<string, string>,
  parentNodeId: string,
) {
  if (!expr || typeof expr !== 'object') return;

  if (expr.type === 'select') {
    const subOutputId = buildSelect(expr, g, cteMap);
    g.addEdge(subOutputId, parentNodeId, 'where');
    return;
  }

  for (const val of Object.values(expr)) {
    if (Array.isArray(val)) {
      for (const item of val) buildSubqueriesInExpr(item, g, cteMap, parentNodeId);
    } else if (val && typeof val === 'object') {
      buildSubqueriesInExpr(val, g, cteMap, parentNodeId);
    }
  }
}

// ── Statement builders (return the "output" node id for chaining) ──

function buildSelect(
  ast: AST,
  g: GraphBuilder,
  cteMap: Map<string, string>,
  selfRef?: RecursiveSelfRef,
): string {
  const sourceIds: string[] = [];

  // FROM sources — each table/subquery is a root node
  if (ast.from) {
    for (const [i, src] of ast.from.entries()) {
      // The first source's range takes in the FROM keyword, the way WHERE, GROUP BY, … do.
      const withFrom = (loc: AstLoc | undefined) => (i === 0 ? g.kwLoc(loc, 'FROM') : loc);
      const isSelfRef = src.type === 'table' && selfRef && tblName(src) === selfRef.selfName;

      if (isSelfRef && !src.join) {
        continue;
      }

      let srcId: string;
      if (isSelfRef) {
        srcId = '';
      } else if (src.type === 'table') {
        const name = tblName(src);
        const alias = tblAlias(src);
        const cteRef = cteMap.get(name);
        if (cteRef) {
          srcId = cteRef;
        } else {
          const nameLoc = astLoc(src.name) ?? astLoc(src);
          const tblLoc = g.alLoc(nameLoc, src.name?.alias);
          srcId = g.addNode(`${name}${alias}`, 'table', withFrom(tblLoc));
        }
      } else if (src.type === 'select') {
        const subId = buildSelect(src, g, cteMap);
        const alias = src.alias?.name ? ` (${src.alias.name})` : '';
        const wrapId = g.addNode(`subquery${alias}`, 'table', withFrom(astLoc(src)));
        g.addEdge(subId, wrapId, 'table');
        srcId = wrapId;
      } else if (src.type === 'statement' && src.statement) {
        const subId = dispatchBuild(src.statement, g, cteMap);
        const alias = src.alias ? ` (${src.alias})` : '';
        const wrapId = g.addNode(`subquery${alias}`, 'table', withFrom(astLoc(src)));
        g.addEdge(subId, wrapId, 'table');
        srcId = wrapId;
      } else {
        const nameLoc = astLoc(src.name) ?? astLoc(src);
        const tblLoc = g.alLoc(nameLoc, src.name?.alias);
        srcId = g.addNode(`${tblName(src)}`, 'table', withFrom(tblLoc));
      }

      if (src.join) {
        const isNatural = src.join.natural || /^NATURAL\b/i.test(src.join.type ?? '');
        const joinType = src.join.type ?? 'JOIN';
        const onClause = !isNatural && src.join.on ? ` ON ${exprToString(src.join.on)}` : '';
        const joinId = g.addNode(`${joinType}${onClause}`, 'join', astLoc(src));

        // Left side: the accumulated result so far
        if (sourceIds.length > 0) {
          g.addEdge(sourceIds[sourceIds.length - 1], joinId, 'join');
          sourceIds[sourceIds.length - 1] = joinId;
        } else {
          sourceIds.push(joinId);
        }

        // Right side: wire the table into the join (skip for self-ref — the recursive edge handles it)
        if (!isSelfRef) {
          g.addEdge(srcId, joinId, 'join');
        }

        if (isSelfRef && selfRef) {
          selfRef.entryNodeId = joinId;
        }

        // CTE refs in ON conditions
        if (src.join.on) linkCteRefsToNode(src.join.on, cteMap, joinId, g);
      } else {
        sourceIds.push(srcId);
      }
    }
  }

  // Merge point: if multiple un-joined sources, they all feed into the next step
  // When selfRef is active and all FROM sources were skipped, currentId stays empty
  // so the first operation becomes a root node (the recursive entry point).
  let currentId = '';
  if (sourceIds.length === 0) {
    if (!selfRef) {
      currentId = g.addNode('(no source)', 'table');
    }
  } else if (sourceIds.length === 1) {
    currentId = sourceIds[0];
  } else {
    const mergeId = g.addNode('CROSS JOIN', 'join');
    for (const sid of sourceIds) {
      g.addEdge(sid, mergeId, 'join');
    }
    currentId = mergeId;
  }

  // WHERE
  if (ast.where) {
    const whereId = g.addNode(`WHERE ${exprToString(ast.where)}`, 'where', g.kwLoc(astLoc(ast.where), 'WHERE'));
    if (currentId) g.addEdge(currentId, whereId, 'where');
    buildSubqueriesInExpr(ast.where, g, cteMap, whereId);
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = whereId;
    currentId = whereId;
  }

  // GROUP BY
  if (ast.groupBy && ast.groupBy.length > 0) {
    const cols = ast.groupBy.map((c: any) => exprToString(c)).join(', ');
    const gbId = g.addNode(`GROUP BY ${cols}`, 'groupby', g.kwLoc(spanLoc(ast.groupBy), 'GROUP BY'));
    if (currentId) g.addEdge(currentId, gbId, 'groupby');
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = gbId;
    currentId = gbId;
  }

  // HAVING
  if (ast.having) {
    const havId = g.addNode(`HAVING ${exprToString(ast.having)}`, 'having', g.kwLoc(astLoc(ast.having), 'HAVING'));
    if (currentId) g.addEdge(currentId, havId, 'having');
    buildSubqueriesInExpr(ast.having, g, cteMap, havId);
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = havId;
    currentId = havId;
  }

  // SELECT (projection)
  if (ast.columns) {
    const cols = ast.columns
      .map((c: any) => {
        const expr = exprToString(c.expr);
        return c.alias?.name ? `${expr} AS ${c.alias.name}` : expr;
      })
      .join(', ');
    const selId = g.addNode(`SELECT ${cols}`, 'select', g.kwLoc(spanLoc(ast.columns), 'SELECT'));
    if (currentId) g.addEdge(currentId, selId, 'select');
    for (const c of ast.columns) {
      buildSubqueriesInExpr(c.expr, g, cteMap, selId);
    }
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = selId;
    currentId = selId;
  }

  // ORDER BY
  if (ast.orderBy && ast.orderBy.length > 0) {
    const parts = ast.orderBy
      .map((o: any) => `${exprToString(o.by)} ${o.order ?? 'ASC'}`)
      .join(', ');
    const obId = g.addNode(`ORDER BY ${parts}`, 'orderby', g.kwLoc(spanLoc(ast.orderBy), 'ORDER BY'));
    if (currentId) g.addEdge(currentId, obId, 'orderby');
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = obId;
    currentId = obId;
  }

  // LIMIT
  if (ast.limit) {
    const val = ast.limit.limit ? exprToString(ast.limit.limit) : '';
    const off = ast.limit.offset ? ` OFFSET ${exprToString(ast.limit.offset)}` : '';
    const limId = g.addNode(`LIMIT ${val}${off}`, 'limit', g.kwLoc(astLoc(ast.limit), 'LIMIT'));
    if (currentId) g.addEdge(currentId, limId, 'limit');
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = limId;
    currentId = limId;
  }

  return currentId;
}

function buildUpdate(ast: AST, g: GraphBuilder, cteMap: Map<string, string>): string {
  const tableName = tblName(ast.table ?? ast);
  const tblId = g.addNode(`${tableName}`, 'table', astLoc(ast.table));
  let currentId = tblId;

  if (ast.where) {
    const wId = g.addNode(`WHERE ${exprToString(ast.where)}`, 'where', g.kwLoc(astLoc(ast.where), 'WHERE'));
    g.addEdge(currentId, wId, 'where');
    buildSubqueriesInExpr(ast.where, g, cteMap, wId);
    currentId = wId;
  }

  if (ast.sets && ast.sets.length > 0) {
    const assignments = ast.sets
      .map((s: any) => `${s.column?.name ?? s.column} = ${exprToString(s.value)}`)
      .join(', ');
    const setId = g.addNode(`SET ${assignments}`, 'set', g.kwLoc(spanLoc(ast.sets), 'SET'));
    g.addEdge(currentId, setId, 'set');
    for (const s of ast.sets) {
      buildSubqueriesInExpr(s.value, g, cteMap, setId);
    }
    currentId = setId;
  }

  const updId = g.addNode(`UPDATE ${tableName}`, 'update', astLoc(ast));
  g.addEdge(currentId, updId, 'update');
  currentId = updId;

  if (ast.returning) {
    const cols = ast.returning.map((r: any) => exprToString(r.expr ?? r)).join(', ');
    const retId = g.addNode(`RETURNING ${cols}`, 'returning', g.kwLoc(spanLoc(ast.returning), 'RETURNING'));
    g.addEdge(currentId, retId, 'returning');
    currentId = retId;
  }

  return currentId;
}

function buildInsert(ast: AST, g: GraphBuilder, cteMap: Map<string, string>): string {
  let currentId = '';

  if (ast.insert) {
    if (ast.insert.type === 'values' && ast.insert.values) {
      const rowCount = ast.insert.values.length;
      const firstRow = ast.insert.values[0];
      const preview = (Array.isArray(firstRow) ? firstRow : [firstRow])
        .map((v: any) => exprToString(v))
        .join(', ');
      const suffix = rowCount > 1 ? ` (+${rowCount - 1} more)` : '';
      currentId = g.addNode(`VALUES (${preview})${suffix}`, 'values', g.kwLoc(astLoc(ast.insert), 'VALUES'));
    } else if (ast.insert.type === 'select') {
      currentId = buildSelect(ast.insert, g, cteMap);
    }
  }

  if (ast.columns && ast.columns.length > 0) {
    const cols = ast.columns.map((c: any) => c.name ?? c).join(', ');
    const colId = g.addNode(`(${cols})`, 'select', spanLoc(ast.columns));
    if (currentId) g.addEdge(currentId, colId, 'insert');
    currentId = colId;
  }

  const insId = g.addNode('INSERT', 'insert', astLoc(ast));
  if (currentId) g.addEdge(currentId, insId, 'insert');
  currentId = insId;

  const tblId = g.addNode(`${tblName(ast.into ?? ast)}`, 'insert_target', astLoc(ast.into));
  g.addEdge(currentId, tblId, 'insert');
  currentId = tblId;

  if (ast.returning) {
    const cols = ast.returning.map((r: any) => exprToString(r.expr ?? r)).join(', ');
    const retId = g.addNode(`RETURNING ${cols}`, 'returning', g.kwLoc(spanLoc(ast.returning), 'RETURNING'));
    g.addEdge(currentId, retId, 'returning');
    currentId = retId;
  }

  return currentId;
}

function buildDelete(ast: AST, g: GraphBuilder, cteMap: Map<string, string>): string {
  const tableName = tblName(ast.from ?? ast);
  const tblId = g.addNode(`${tableName}`, 'table', astLoc(ast.from));
  let currentId = tblId;

  if (ast.where) {
    const wId = g.addNode(`WHERE ${exprToString(ast.where)}`, 'where', g.kwLoc(astLoc(ast.where), 'WHERE'));
    g.addEdge(currentId, wId, 'where');
    buildSubqueriesInExpr(ast.where, g, cteMap, wId);
    currentId = wId;
  }

  const delId = g.addNode(`DELETE FROM ${tableName}`, 'delete', astLoc(ast));
  g.addEdge(currentId, delId, 'delete');
  currentId = delId;

  if (ast.returning) {
    const cols = ast.returning.map((r: any) => exprToString(r.expr ?? r)).join(', ');
    const retId = g.addNode(`RETURNING ${cols}`, 'returning', g.kwLoc(spanLoc(ast.returning), 'RETURNING'));
    g.addEdge(currentId, retId, 'returning');
    currentId = retId;
  }

  return currentId;
}

function buildCreateTable(ast: AST, g: GraphBuilder): string {
  const createId = g.addNode(`CREATE TABLE ${tblName(ast)}`, 'create', astLoc(ast));
  let lastId = createId;

  if (ast.columns) {
    for (const col of ast.columns) {
      if (col.kind === 'column') {
        const name = col.name?.name ?? col.name ?? '?';
        const dataType = col.dataType?.name ?? '';
        const config = col.dataType?.config ? `(${col.dataType.config.join(', ')})` : '';
        const constraints = (col.constraints ?? [])
          .map((c: any) => c.type ?? '')
          .filter(Boolean)
          .join(', ');
        const suffix = constraints ? ` [${constraints}]` : '';
        const colId = g.addNode(`  ${name} ${dataType}${config}${suffix}`, 'column', astLoc(col));
        g.addEdge(createId, colId, 'column');
        lastId = colId;
      }
    }
  }

  return lastId;
}

function containsTableRef(node: any, name: string): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'table' && tblName(node) === name) return true;
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        if (containsTableRef(item, name)) return true;
      }
    } else if (val && typeof val === 'object') {
      if (containsTableRef(val, name)) return true;
    }
  }
  return false;
}

function buildWith(ast: AST, g: GraphBuilder): string {
  const cteMap = new Map<string, string>();

  if (ast.bind && Array.isArray(ast.bind)) {
    for (const [i, cte] of ast.bind.entries()) {
      const name = cte.alias?.name ?? '?';
      // The first CTE's range takes in the WITH keyword, so clicking WITH selects it.
      const cteLoc = i === 0 ? g.kwLoc(astLoc(cte), 'WITH') : astLoc(cte);
      const stmt = cte.statement;
      const isUnion = stmt && (stmt.type === 'union' || stmt.type === 'union all');
      const isRecursive = isUnion && containsTableRef(stmt, name);

      if (isRecursive) {
        const cteHeaderId = g.addNode(`RECURSIVE: ${name}`, 'cte', cteLoc);

        const unionId = g.addNode(stmt.type.toUpperCase(), 'union', astLoc(stmt));
        g.addEdge(unionId, cteHeaderId, 'cte');

        if (stmt.left) {
          const leftId = dispatchBuild(stmt.left, g, new Map(cteMap));
          g.addEdge(leftId, unionId, 'union');
        }

        if (stmt.right) {
          const selfRef: RecursiveSelfRef = { selfName: name, entryNodeId: null };
          let rightId: string;
          if (stmt.right.type === 'select') {
            rightId = buildSelect(stmt.right, g, new Map(cteMap), selfRef);
          } else {
            rightId = dispatchBuild(stmt.right, g, new Map(cteMap));
          }
          g.addEdge(rightId, unionId, 'union');

          if (selfRef.entryNodeId) {
            g.addEdge(cteHeaderId, selfRef.entryNodeId, 'cte', true);
          }
        }

        cteMap.set(name, cteHeaderId);
      } else {
        const cteHeaderId = g.addNode(`CTE: ${name}`, 'cte', cteLoc);

        if (stmt) {
          const innerOutputId = dispatchBuild(stmt, g, new Map(cteMap));
          g.addEdge(innerOutputId, cteHeaderId, 'cte');
        }

        cteMap.set(name, cteHeaderId);
      }
    }
  }

  if (ast.in) {
    return dispatchBuild(ast.in, g, cteMap);
  }

  return cteMap.values().next().value ?? g.addNode('WITH (empty)', 'cte');
}

function buildWithRecursive(ast: AST, g: GraphBuilder): string {
  const name = ast.alias?.name ?? '?';
  const cols = ast.columnNames?.map((c: any) => c.name ?? c).join(', ');
  const colSuffix = cols ? `(${cols})` : '';
  // From WITH to the end of the CTE body (the statement's own range also covers the main query);
  // addNode extends it over the body's closing parenthesis.
  const start = astLoc(ast)?.start;
  const bodyEnd = astLoc(ast.bind)?.end;
  const cteLoc = start !== undefined && bodyEnd !== undefined ? { start, end: bodyEnd } : undefined;
  const cteId = g.addNode(`RECURSIVE: ${name}${colSuffix}`, 'cte', cteLoc);

  if (ast.bind) {
    if (ast.bind.type === 'union' || ast.bind.type === 'union all') {
      const unionId = g.addNode(`${ast.bind.type.toUpperCase()}`, 'union', astLoc(ast.bind));
      g.addEdge(unionId, cteId, 'cte');

      // Base case (left) — no self-reference in scope
      if (ast.bind.left) {
        const leftId = dispatchBuild(ast.bind.left, g, new Map());
        g.addEdge(leftId, unionId, 'union');
      }

      // Recursive step (right) — skip the self-referencing FROM entirely,
      // track the first operation node so we can draw the loop edge to it.
      if (ast.bind.right) {
        const selfRef: RecursiveSelfRef = { selfName: name, entryNodeId: null };

        let rightId: string;
        if (ast.bind.right.type === 'select') {
          rightId = buildSelect(ast.bind.right, g, new Map(), selfRef);
        } else {
          rightId = dispatchBuild(ast.bind.right, g, new Map());
        }
        g.addEdge(rightId, unionId, 'union');

        // Draw recursive feedback loop: CTE output → first op of recursive step
        if (selfRef.entryNodeId) {
          g.addEdge(cteId, selfRef.entryNodeId, 'cte', true);
        }
      }
    }
  }

  const cteMap = new Map<string, string>();
  cteMap.set(name, cteId);

  if (ast.in) {
    return dispatchBuild(ast.in, g, cteMap);
  }

  return cteId;
}

function buildUnion(ast: AST, g: GraphBuilder, cteMap: Map<string, string>): string {
  const type = (ast.type ?? 'union').toUpperCase();
  const unionId = g.addNode(`${type}`, 'union', astLoc(ast));

  let trailingOrderBy: any[] | undefined;
  let trailingLimit: any | undefined;

  if (ast.left) {
    const leftId = dispatchBuild(ast.left, g, cteMap);
    g.addEdge(leftId, unionId, 'union');
  }
  if (ast.right) {
    const right = ast.right;
    if (right.type === 'select' && (right.orderBy || right.limit)) {
      trailingOrderBy = right.orderBy;
      trailingLimit = right.limit;
      const stripped = { ...right, orderBy: undefined, limit: undefined };
      const rightId = dispatchBuild(stripped, g, cteMap);
      g.addEdge(rightId, unionId, 'union');
    } else {
      const rightId = dispatchBuild(right, g, cteMap);
      g.addEdge(rightId, unionId, 'union');
    }
  }

  let currentId = unionId;

  const orderBy = ast.orderBy ?? trailingOrderBy;
  if (orderBy && orderBy.length > 0) {
    const parts = orderBy
      .map((o: any) => `${exprToString(o.by)} ${o.order ?? 'ASC'}`)
      .join(', ');
    const obId = g.addNode(`ORDER BY ${parts}`, 'orderby', g.kwLoc(spanLoc(orderBy), 'ORDER BY'));
    g.addEdge(currentId, obId, 'orderby');
    currentId = obId;
  }

  const limit = ast.limit ?? trailingLimit;
  if (limit) {
    const val = limit.limit ? exprToString(limit.limit) : '';
    const off = limit.offset ? ` OFFSET ${exprToString(limit.offset)}` : '';
    const limId = g.addNode(`LIMIT ${val}${off}`, 'limit', g.kwLoc(astLoc(limit), 'LIMIT'));
    g.addEdge(currentId, limId, 'limit');
    currentId = limId;
  }

  return currentId;
}

function buildGeneric(ast: AST, g: GraphBuilder): string {
  const type = String(ast.type ?? 'unknown').toUpperCase();
  const opId = g.addNode(`${type}`, 'operation', astLoc(ast));

  const table = ast.table ?? ast.from ?? ast.name;
  if (table) {
    const tId = g.addNode(`${tblName(table)}`, 'table', astLoc(table));
    g.addEdge(tId, opId, 'operation');
  }

  if (ast.where) {
    const wId = g.addNode(`WHERE ${exprToString(ast.where)}`, 'where', g.kwLoc(astLoc(ast.where), 'WHERE'));
    g.addEdge(opId, wId, 'where');
    return wId;
  }

  return opId;
}

function dispatchBuild(ast: AST, g: GraphBuilder, cteMap: Map<string, string>): string {
  switch (ast.type) {
    case 'select':
      return buildSelect(ast, g, cteMap);
    case 'update':
      return buildUpdate(ast, g, cteMap);
    case 'insert':
      return buildInsert(ast, g, cteMap);
    case 'delete':
      return buildDelete(ast, g, cteMap);
    case 'create table':
      return buildCreateTable(ast, g);
    case 'with':
      return buildWith(ast, g);
    case 'with recursive':
      return buildWithRecursive(ast, g);
    case 'union':
    case 'union all':
    case 'intersect':
    case 'except':
      return buildUnion(ast, g, cteMap);
    default:
      return buildGeneric(ast, g);
  }
}

export function buildFlowFromAST(astInput: unknown, sql = ''): FlowGraph {
  if (!astInput) return { nodes: [], edges: [] };

  const statements = Array.isArray(astInput) ? astInput : [astInput];
  if (statements.length === 0) return { nodes: [], edges: [] };

  const g = new GraphBuilder(sql);
  for (const ast of statements) {
    if (!ast || typeof ast !== 'object' || !(ast as AST).type) continue;
    dispatchBuild(ast as AST, g, new Map());
  }
  return g.layout();
}
