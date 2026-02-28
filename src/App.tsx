import { useCallback, useEffect, useRef, useState } from 'react';
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
import Editor from '@monaco-editor/react';
import { buildFlowFromAST } from './buildFlowFromAST';
import RecursiveEdge from './RecursiveEdge';
import styles from './App.module.css';

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

function AppInner() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { fitView } = useReactFlow();

  const parseSql = useCallback((raw: string) => {
    const input = sanitizeInput(raw);

    if (!input) {
      setNodes([]);
      setEdges([]);
      setParseError(null);
      return;
    }

    try {
      const ast = parse(input);
      const graph = buildFlowFromAST(ast);

      setNodes(graph.nodes);
      setEdges(graph.edges);
      setParseError(null);
    } catch (err) {
      const message = extractErrorMessage(err);
      console.warn('[SQL Parse Error]', message);
      setParseError(message);
    }
  }, []);

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

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

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
          <ReactFlow
            nodes={nodes}
            edges={edges}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
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
