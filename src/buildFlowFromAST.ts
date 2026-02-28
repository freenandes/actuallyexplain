import { MarkerType, type Node, type Edge } from '@xyflow/react';
import dagre from 'dagre';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AST = Record<string, any>;

const NODE_WIDTH = 280;
const NODE_HEIGHT = 50;
const MAX_LABEL = 80;

const nodeColors: Record<string, string> = {
  table: '#3fb950',
  join: '#d29922',
  where: '#f85149',
  select: '#58a6ff',
  orderby: '#bc8cff',
  groupby: '#f778ba',
  having: '#f778ba',
  update: '#d29922',
  set: '#e3b341',
  insert: '#58a6ff',
  values: '#bc8cff',
  delete: '#f85149',
  create: '#3fb950',
  column: '#8b949e',
  drop: '#f85149',
  alter: '#d29922',
  action: '#bc8cff',
  operation: '#58a6ff',
  cte: '#d2a8ff',
  limit: '#8b949e',
  returning: '#79c0ff',
  union: '#d2a8ff',
};

function makeNodeStyle(kind: string) {
  return {
    background: '#1c2129',
    color: '#e6edf3',
    border: `1px solid ${nodeColors[kind] ?? '#58a6ff'}`,
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    width: NODE_WIDTH,
  };
}

function truncate(str: string, max = MAX_LABEL): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ── Expression → readable string ──

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
    case 'binary':
      return `${exprToString(e.left, depth + 1)} ${e.op} ${exprToString(e.right, depth + 1)}`;
    case 'unary':
      return `${e.op} ${exprToString(e.operand, depth + 1)}`;
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
    case 'ternary':
      return `${exprToString(e.value, depth + 1)} BETWEEN ${exprToString(e.lo, depth + 1)} AND ${exprToString(e.hi, depth + 1)}`;
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

// ── Graph builder (coordinates-free, dagre computes layout) ──

interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
}

interface RawNode {
  id: string;
  label: string;
  kind: string;
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

  addNode(label: string, kind: string): string {
    const id = `n-${this.idCounter++}`;
    this.nodes.push({ id, label: truncate(label), kind });
    return id;
  }

  addEdge(source: string, target: string, kind?: string, isRecursive?: boolean) {
    this.edges.push({ source, target, kind: kind ?? 'select', isRecursive });
  }

  layout(): FlowGraph {
    if (this.nodes.length === 0) return { nodes: [], edges: [] };

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80, marginx: 40, marginy: 40 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const n of this.nodes) {
      g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const e of this.edges) {
      if (!e.isRecursive) {
        g.setEdge(e.source, e.target);
      }
    }

    dagre.layout(g);

    // Right bound of the graph — recursive edges route past this
    const maxRightX = Math.max(
      ...this.nodes.map((n) => g.node(n.id).x + NODE_WIDTH / 2),
    );

    const flowNodes: Node[] = this.nodes.map((n) => {
      const pos = g.node(n.id);
      return {
        id: n.id,
        type: 'default',
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
        data: { label: n.label },
        style: makeNodeStyle(n.kind),
      };
    });

    const arrow = {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
    };

    const flowEdges: Edge[] = this.edges.map((e, i) => {
      const color = nodeColors[e.kind] ?? '#58a6ff';
      if (e.isRecursive) {
        const srcPos = g.node(e.source);
        const tgtPos = g.node(e.target);
        return {
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          type: 'recursive',
          animated: true,
          markerEnd: { ...arrow, color: '#d2a8ff' },
          data: {
            fromX: srcPos.x + NODE_WIDTH / 2,
            fromY: srcPos.y,
            toX: tgtPos.x + NODE_WIDTH / 2,
            toY: tgtPos.y,
            loopX: maxRightX + 80,
          },
          style: {
            stroke: '#d2a8ff',
            strokeDasharray: '6 3',
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
        style: { stroke: color },
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
    for (const src of ast.from) {
      if (src.type === 'table') {
        const name = tblName(src);
        if (selfRef && name === selfRef.selfName) {
          continue;
        }
      }

      let srcId: string;
      if (src.type === 'table') {
        const name = tblName(src);
        const alias = tblAlias(src);
        const cteRef = cteMap.get(name);
        if (cteRef) {
          srcId = cteRef;
        } else {
          srcId = g.addNode(`📦 ${name}${alias}`, 'table');
        }
      } else if (src.type === 'select') {
        const subId = buildSelect(src, g, cteMap);
        const alias = src.alias?.name ? ` (${src.alias.name})` : '';
        const wrapId = g.addNode(`📦 subquery${alias}`, 'table');
        g.addEdge(subId, wrapId, 'table');
        srcId = wrapId;
      } else {
        srcId = g.addNode(`📦 ${tblName(src)}`, 'table');
      }

      if (src.join) {
        const joinType = src.join.type ?? 'JOIN';
        const onClause = src.join.on ? ` ON ${exprToString(src.join.on)}` : '';
        const joinId = g.addNode(`🔗 ${joinType}${onClause}`, 'join');

        // Left side: the accumulated result so far
        if (sourceIds.length > 0) {
          g.addEdge(sourceIds[sourceIds.length - 1], joinId, 'join');
          sourceIds[sourceIds.length - 1] = joinId;
        } else {
          sourceIds.push(joinId);
        }

        // Right side: this table
        g.addEdge(srcId, joinId, 'join');

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
      currentId = g.addNode('📦 (no source)', 'table');
    }
  } else if (sourceIds.length === 1) {
    currentId = sourceIds[0];
  } else {
    const mergeId = g.addNode('✖️ CROSS JOIN', 'join');
    for (const sid of sourceIds) {
      g.addEdge(sid, mergeId, 'join');
    }
    currentId = mergeId;
  }

  // WHERE
  if (ast.where) {
    const whereId = g.addNode(`🔍 WHERE ${exprToString(ast.where)}`, 'where');
    if (currentId) g.addEdge(currentId, whereId, 'where');
    buildSubqueriesInExpr(ast.where, g, cteMap, whereId);
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = whereId;
    currentId = whereId;
  }

  // GROUP BY
  if (ast.groupBy && ast.groupBy.length > 0) {
    const cols = ast.groupBy.map((c: any) => exprToString(c)).join(', ');
    const gbId = g.addNode(`📊 GROUP BY ${cols}`, 'groupby');
    if (currentId) g.addEdge(currentId, gbId, 'groupby');
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = gbId;
    currentId = gbId;
  }

  // HAVING
  if (ast.having) {
    const havId = g.addNode(`🔍 HAVING ${exprToString(ast.having)}`, 'having');
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
    const selId = g.addNode(`📋 SELECT ${cols}`, 'select');
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
    const obId = g.addNode(`⬆⬇ ORDER BY ${parts}`, 'orderby');
    if (currentId) g.addEdge(currentId, obId, 'orderby');
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = obId;
    currentId = obId;
  }

  // LIMIT
  if (ast.limit) {
    const val = ast.limit.limit ? exprToString(ast.limit.limit) : '';
    const off = ast.limit.offset ? ` OFFSET ${exprToString(ast.limit.offset)}` : '';
    const limId = g.addNode(`✂️ LIMIT ${val}${off}`, 'limit');
    if (currentId) g.addEdge(currentId, limId, 'limit');
    if (selfRef && !selfRef.entryNodeId) selfRef.entryNodeId = limId;
    currentId = limId;
  }

  return currentId;
}

function buildUpdate(ast: AST, g: GraphBuilder, cteMap: Map<string, string>): string {
  const tableName = tblName(ast.table ?? ast);
  const tblId = g.addNode(`📦 ${tableName}`, 'table');
  let currentId = tblId;

  if (ast.where) {
    const wId = g.addNode(`🔍 WHERE ${exprToString(ast.where)}`, 'where');
    g.addEdge(currentId, wId, 'where');
    buildSubqueriesInExpr(ast.where, g, cteMap, wId);
    currentId = wId;
  }

  if (ast.sets && ast.sets.length > 0) {
    const assignments = ast.sets
      .map((s: any) => `${s.column?.name ?? s.column} = ${exprToString(s.value)}`)
      .join(', ');
    const setId = g.addNode(`📝 SET ${assignments}`, 'set');
    g.addEdge(currentId, setId, 'set');
    for (const s of ast.sets) {
      buildSubqueriesInExpr(s.value, g, cteMap, setId);
    }
    currentId = setId;
  }

  const updId = g.addNode(`✏️ UPDATE ${tableName}`, 'update');
  g.addEdge(currentId, updId, 'update');
  currentId = updId;

  if (ast.returning) {
    const cols = ast.returning.map((r: any) => exprToString(r.expr ?? r)).join(', ');
    const retId = g.addNode(`↩️ RETURNING ${cols}`, 'returning');
    g.addEdge(currentId, retId, 'returning');
    currentId = retId;
  }

  return currentId;
}

function buildInsert(ast: AST, g: GraphBuilder, cteMap: Map<string, string>): string {
  // Data source at the top (VALUES or SELECT)
  let currentId = '';

  if (ast.insert) {
    if (ast.insert.type === 'values' && ast.insert.values) {
      const rowCount = ast.insert.values.length;
      const firstRow = ast.insert.values[0];
      const preview = (Array.isArray(firstRow) ? firstRow : [firstRow])
        .map((v: any) => exprToString(v))
        .join(', ');
      const suffix = rowCount > 1 ? ` (+${rowCount - 1} more)` : '';
      currentId = g.addNode(`📦 VALUES (${preview})${suffix}`, 'values');
    } else if (ast.insert.type === 'select') {
      currentId = buildSelect(ast.insert, g, cteMap);
    }
  }

  // Column mapping
  if (ast.columns && ast.columns.length > 0) {
    const cols = ast.columns.map((c: any) => c.name ?? c).join(', ');
    const colId = g.addNode(`📋 (${cols})`, 'select');
    if (currentId) g.addEdge(currentId, colId, 'insert');
    currentId = colId;
  }

  // INSERT operation
  const insId = g.addNode(`➕ INSERT`, 'insert');
  if (currentId) g.addEdge(currentId, insId, 'insert');
  currentId = insId;

  // Target table at the bottom (destination)
  const tblId = g.addNode(`🎯 ${tblName(ast.into ?? ast)}`, 'table');
  g.addEdge(currentId, tblId, 'insert');
  currentId = tblId;

  if (ast.returning) {
    const cols = ast.returning.map((r: any) => exprToString(r.expr ?? r)).join(', ');
    const retId = g.addNode(`↩️ RETURNING ${cols}`, 'returning');
    g.addEdge(currentId, retId, 'returning');
    currentId = retId;
  }

  return currentId;
}

function buildDelete(ast: AST, g: GraphBuilder, cteMap: Map<string, string>): string {
  const tableName = tblName(ast.from ?? ast);
  const tblId = g.addNode(`📦 ${tableName}`, 'table');
  let currentId = tblId;

  if (ast.where) {
    const wId = g.addNode(`🔍 WHERE ${exprToString(ast.where)}`, 'where');
    g.addEdge(currentId, wId, 'where');
    buildSubqueriesInExpr(ast.where, g, cteMap, wId);
    currentId = wId;
  }

  const delId = g.addNode(`🗑️ DELETE FROM ${tableName}`, 'delete');
  g.addEdge(currentId, delId, 'delete');
  currentId = delId;

  if (ast.returning) {
    const cols = ast.returning.map((r: any) => exprToString(r.expr ?? r)).join(', ');
    const retId = g.addNode(`↩️ RETURNING ${cols}`, 'returning');
    g.addEdge(currentId, retId, 'returning');
    currentId = retId;
  }

  return currentId;
}

function buildCreateTable(ast: AST, g: GraphBuilder): string {
  const createId = g.addNode(`🏗️ CREATE TABLE ${tblName(ast)}`, 'create');
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
        const colId = g.addNode(`  ${name} ${dataType}${config}${suffix}`, 'column');
        g.addEdge(createId, colId, 'column');
        lastId = colId;
      }
    }
  }

  return lastId;
}

function buildWith(ast: AST, g: GraphBuilder): string {
  const cteMap = new Map<string, string>();

  if (ast.bind && Array.isArray(ast.bind)) {
    for (const cte of ast.bind) {
      const name = cte.alias?.name ?? '?';
      const cteHeaderId = g.addNode(`📎 CTE: ${name}`, 'cte');

      if (cte.statement) {
        // Pass accumulated cteMap so later CTEs can reference earlier ones
        const innerOutputId = dispatchBuild(cte.statement, g, new Map(cteMap));
        g.addEdge(innerOutputId, cteHeaderId, 'cte');
      }

      cteMap.set(name, cteHeaderId);
    }
  }

  if (ast.in) {
    return dispatchBuild(ast.in, g, cteMap);
  }

  return cteMap.values().next().value ?? g.addNode('📎 WITH (empty)', 'cte');
}

function buildWithRecursive(ast: AST, g: GraphBuilder): string {
  const name = ast.alias?.name ?? '?';
  const cols = ast.columnNames?.map((c: any) => c.name ?? c).join(', ');
  const colSuffix = cols ? `(${cols})` : '';
  const cteId = g.addNode(`🔄 RECURSIVE: ${name}${colSuffix}`, 'cte');

  if (ast.bind) {
    if (ast.bind.type === 'union' || ast.bind.type === 'union all') {
      const unionId = g.addNode(`🔀 ${ast.bind.type.toUpperCase()}`, 'union');
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
  const unionId = g.addNode(`🔀 ${type}`, 'union');

  if (ast.left) {
    const leftId = dispatchBuild(ast.left, g, cteMap);
    g.addEdge(leftId, unionId, 'union');
  }
  if (ast.right) {
    const rightId = dispatchBuild(ast.right, g, cteMap);
    g.addEdge(rightId, unionId, 'union');
  }

  return unionId;
}

function buildGeneric(ast: AST, g: GraphBuilder): string {
  const type = String(ast.type ?? 'unknown').toUpperCase();
  const opId = g.addNode(`⚙️ ${type}`, 'operation');

  const table = ast.table ?? ast.from ?? ast.name;
  if (table) {
    const tId = g.addNode(`📦 ${tblName(table)}`, 'table');
    g.addEdge(tId, opId, 'operation');
  }

  if (ast.where) {
    const wId = g.addNode(`🔍 WHERE ${exprToString(ast.where)}`, 'where');
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

export function buildFlowFromAST(astInput: unknown): FlowGraph {
  if (!astInput) return { nodes: [], edges: [] };

  const statements = Array.isArray(astInput) ? astInput : [astInput];
  if (statements.length === 0) return { nodes: [], edges: [] };

  const ast = statements[0] as AST;
  if (!ast || !ast.type) return { nodes: [], edges: [] };

  const g = new GraphBuilder();
  dispatchBuild(ast, g, new Map());
  return g.layout();
}
