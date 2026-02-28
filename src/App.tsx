import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parse } from 'pgsql-ast-parser';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { buildFlowFromAST, type AstLoc } from './buildFlowFromAST';
import RecursiveEdge from './RecursiveEdge';
import SqlNode from './SqlNode';
import NodeDetailsPanel from './NodeDetailsPanel';
import { NodeActionsContext } from './NodeActionsContext';
import styles from './App.module.css';

const nodeTypes = { sql: SqlNode };
const edgeTypes = { recursive: RecursiveEdge };

const DEFAULT_SQL = `SELECT
  u.id,
  u.name,
  o.total
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.total > 100
ORDER BY o.total DESC;`;

const DEBOUNCE_MS = 300;

function sanitizeInput(raw: string): string {
  return raw
    .replace(/\uFEFF/g, '')              // BOM
    .replace(/[\u200B-\u200D\u2060]/g, '') // zero-width chars
    .replace(/[\u2018\u2019]/g, "'")      // smart single quotes → '
    .replace(/[\u201C\u201D]/g, '"')      // smart double quotes → "
    .replace(/\u2014/g, '--')             // em-dash → --
    .replace(/\u2013/g, '-')              // en-dash → -
    .replace(/\r\n/g, '\n')              // normalize line endings
    .replace(/\r/g, '\n')
    .trim();
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

const HIGHLIGHT_GLOW = '0 0 0 2px #58a6ff, 0 0 16px rgba(88, 166, 255, 0.4)';

function findNodeAtOffset(nodes: Node[], offset: number): Node | null {
  let best: Node | null = null;
  let bestSize = Infinity;
  for (const n of nodes) {
    const loc = n.data?.loc as AstLoc | undefined;
    if (!loc) continue;
    if (offset >= loc.start && offset <= loc.end) {
      const size = loc.end - loc.start;
      if (size < bestSize) {
        best = n;
        bestSize = size;
      }
    }
  }
  return best;
}

function AppInner() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { fitView } = useReactFlow();

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const suppressCursorRef = useRef(false);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  const highlightRange = useCallback((loc: AstLoc) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    const startPos = model.getPositionAt(loc.start);
    const endPos = model.getPositionAt(loc.end);
    const range = new monaco.Range(
      startPos.lineNumber, startPos.column,
      endPos.lineNumber, endPos.column,
    );

    decorationsRef.current?.set([{
      range,
      options: {
        className: 'sql-highlight',
        isWholeLine: false,
      },
    }]);
  }, []);

  const clearHighlight = useCallback(() => {
    setHighlightedNodeId(null);
    setSelectedNode(null);
    decorationsRef.current?.set([]);
  }, []);

  const parseSql = useCallback((raw: string) => {
    const input = sanitizeInput(raw);
    clearHighlight();

    if (!input) {
      setNodes([]);
      setEdges([]);
      setParseError(null);
      return;
    }

    try {
      const ast = parse(input, { locationTracking: true });
      const graph = buildFlowFromAST(ast, input);

      setNodes(graph.nodes);
      setEdges(graph.edges);
      setParseError(null);
    } catch (err) {
      const message = extractErrorMessage(err);
      console.warn('[SQL Parse Error]', message);
      setParseError(message);
    }
  }, [clearHighlight]);

  useEffect(() => {
    parseSql(DEFAULT_SQL);
  }, [parseSql]);

  const prevNodeCount = useRef(0);
  useEffect(() => {
    if (nodes.length > 0 && nodes.length !== prevNodeCount.current) {
      setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 30);
    }
    prevNodeCount.current = nodes.length;
  }, [nodes, fitView]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? '';
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => parseSql(next), DEBOUNCE_MS);
    },
    [parseSql],
  );

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorationsRef.current = editor.createDecorationsCollection([]);

    editor.onDidChangeCursorPosition((e) => {
      if (suppressCursorRef.current) return;
      if (e.reason === 3) {
        // reason 3 = Explicit (click or keyboard navigation)
        const model = editor.getModel();
        if (!model) return;
        const offset = model.getOffsetAt(e.position);
        const match = findNodeAtOffset(nodesRef.current, offset);
        if (match) {
          setHighlightedNodeId(match.id);
          const loc = match.data?.loc as AstLoc | undefined;
          if (loc) highlightRange(loc);
        } else {
          clearHighlight();
        }
      }
    });
  }, [highlightRange, clearHighlight]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const loc = node.data?.loc as AstLoc | undefined;
    setHighlightedNodeId(node.id);
    setSelectedNode((prev) => prev !== null ? node : null);
    if (loc) {
      suppressCursorRef.current = true;
      highlightRange(loc);

      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (editor && monaco) {
        const model = editor.getModel();
        if (model) {
          const pos = model.getPositionAt(loc.start);
          editor.revealRangeInCenter(new monaco.Range(
            pos.lineNumber, pos.column,
            model.getPositionAt(loc.end).lineNumber,
            model.getPositionAt(loc.end).column,
          ));
        }
      }
      requestAnimationFrame(() => { suppressCursorRef.current = false; });
    }
  }, [highlightRange]);

  const handlePaneClick = useCallback(() => {
    clearHighlight();
  }, [clearHighlight]);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const openDetails = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    setSelectedNode(node);
    setHighlightedNodeId(node.id);
    const loc = node.data?.loc as AstLoc | undefined;
    if (loc) {
      suppressCursorRef.current = true;
      highlightRange(loc);
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (editor && monaco) {
        const model = editor.getModel();
        if (model) {
          const pos = model.getPositionAt(loc.start);
          editor.revealRangeInCenter(new monaco.Range(
            pos.lineNumber, pos.column,
            model.getPositionAt(loc.end).lineNumber,
            model.getPositionAt(loc.end).column,
          ));
        }
      }
      requestAnimationFrame(() => { suppressCursorRef.current = false; });
    }
  }, [highlightRange]);

  const nodeActions = useMemo(() => ({ openDetails }), [openDetails]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const displayNodes = useMemo(() => {
    if (!highlightedNodeId) return nodes;
    return nodes.map((n) =>
      n.id === highlightedNodeId
        ? { ...n, style: { ...n.style, boxShadow: HIGHLIGHT_GLOW } }
        : n,
    );
  }, [nodes, highlightedNodeId]);

  return (
    <div className={styles.container}>
      {/* ─── Left: SQL Editor ─── */}
      <aside className={styles.editorPane}>
        <div className={styles.paneHeader}>
          <span className={styles.paneHeaderIcon}>⟫</span>
          SQL Input
          {parseError && (
            <span className={styles.errorBadge} title={parseError}>
              syntax error
            </span>
          )}
        </div>
        {parseError && (
          <div className={styles.errorBar}>{shortenError(parseError)}</div>
        )}
        <div className={styles.editorWrapper}>
          <Editor
            defaultLanguage="sql"
            defaultValue={DEFAULT_SQL}
            onChange={handleChange}
            onMount={handleEditorMount}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              padding: { top: 16 },
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        </div>
      </aside>

      {/* ─── Right: Flow Canvas ─── */}
      <main className={styles.flowPane}>
        <div className={styles.paneHeader}>
          <span className={styles.paneHeaderIcon}>◈</span>
          Query Plan
        </div>
        <div className={styles.flowWrapper}>
          <NodeActionsContext.Provider value={nodeActions}>
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color="#30363d"
              />
              <Controls
                showInteractive={false}
                style={{
                  background: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                }}
              />
            </ReactFlow>
          </NodeActionsContext.Provider>
          {selectedNode && (
            <div style={{ '--node-color': selectedNode.style?.['--node-color' as keyof typeof selectedNode.style] ?? '#58a6ff' } as React.CSSProperties}>
              <NodeDetailsPanel node={selectedNode} onClose={handleClosePanel} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}

export default App;
