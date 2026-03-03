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
import { Analytics } from '@vercel/analytics/react';
import { CircleQuestionMark, Code2, Workflow } from 'lucide-react';
import AboutModal from './AboutModal';
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
const PANEL_CLOSE_MS = 400;

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
  const [isClosingPanel, setIsClosingPanel] = useState(false);
  const [mobileView, setMobileView] = useState<'editor' | 'diagram'>('editor');
  const [showAbout, setShowAbout] = useState(false);
  const [isClosingAbout, setIsClosingAbout] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closePanelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeAboutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { fitView } = useReactFlow();

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const suppressCursorRef = useRef(false);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  useEffect(() => {
    return () => {
      if (closePanelTimeoutRef.current) {
        clearTimeout(closePanelTimeoutRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    if (mobileView === 'diagram') {
      const t = setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50);
      return () => clearTimeout(t);
    }
  }, [mobileView, fitView]);

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

    monaco.editor.defineTheme('actuallyexplain', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '',                       foreground: 'E6E4D9' },
        { token: 'keyword.sql',            foreground: '66A0C8' },
        { token: 'string.sql',             foreground: 'EC8B49' },
        { token: 'string.double.sql',      foreground: 'EC8B49' },
        { token: 'number.sql',             foreground: 'DFB431' },
        { token: 'number.hex.sql',         foreground: 'E47DA8' },
        { token: 'comment.sql',            foreground: 'A0AF54', fontStyle: 'italic' },
        { token: 'comment.block.sql',      foreground: 'A0AF54', fontStyle: 'italic' },
        { token: 'operator.sql',           foreground: 'A699D0' },
        { token: 'operator.keyword.sql',   foreground: '66A0C8' },
        { token: 'identifier.sql',         foreground: 'E6E4D9' },
        { token: 'type.sql',               foreground: '5ABDAC' },
        { token: 'predefined.sql',         foreground: '66A0C8' },
        { token: 'delimiter.sql',          foreground: '9F9D96' },
        { token: 'white.sql',              foreground: 'E6E4D9' },
      ],
      colors: {
        'editor.background': '#100F0F',
        'editor.foreground': '#E6E4D9',
        'editor.lineHighlightBackground': '#5ABDAC22',
        'editor.selectionBackground': '#5ABDAC44',
        'editor.inactiveSelectionBackground': '#5ABDAC33',
        'editorLineNumber.foreground': '#6F6E69',
        'editorLineNumber.activeForeground': '#E6E4D9',
        'editorCursor.foreground': '#5ABDAC',
        'scrollbarSlider.background': '#E6E4D922',
        'scrollbarSlider.hoverBackground': '#E6E4D944',
        'scrollbarSlider.activeBackground': '#E6E4D966',
      },
    });
    monaco.editor.setTheme('actuallyexplain');

    // Let Cmd/Ctrl+F and Cmd/Ctrl+H pass through to the browser instead of Monaco's find widget
    editor.getDomNode()?.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'h')) {
        e.stopPropagation();
      }
    }, true);

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
    if (closePanelTimeoutRef.current) {
      clearTimeout(closePanelTimeoutRef.current);
      closePanelTimeoutRef.current = null;
    }
    setIsClosingPanel(false);

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

  const handleCloseAbout = useCallback(() => {
    if (!showAbout || isClosingAbout) return;
    setIsClosingAbout(true);
    closeAboutTimeoutRef.current = setTimeout(() => {
      setShowAbout(false);
      setIsClosingAbout(false);
      closeAboutTimeoutRef.current = null;
    }, PANEL_CLOSE_MS);
  }, [showAbout, isClosingAbout]);

  const handleClosePanel = useCallback(() => {
    if (!selectedNode || isClosingPanel) return;
    setIsClosingPanel(true);
    closePanelTimeoutRef.current = setTimeout(() => {
      setSelectedNode(null);
      setIsClosingPanel(false);
      closePanelTimeoutRef.current = null;
    }, PANEL_CLOSE_MS);
  }, [selectedNode, isClosingPanel]);

  const openDetails = useCallback((nodeId: string) => {
    if (closePanelTimeoutRef.current) {
      clearTimeout(closePanelTimeoutRef.current);
      closePanelTimeoutRef.current = null;
    }
    setIsClosingPanel(false);

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
        ? { ...n, style: {
          ...n.style,
          outline: '2px solid rgb(90, 189, 172)',
          outlineOffset: 2,
          boxShadow: '0 0 16px 6px rgba(90, 189, 172, 0.3)'
        } }
        : n,
    );
  }, [nodes, highlightedNodeId]);

  return (
    <div className={styles.container} data-mobile-view={mobileView}>
      {/* ─── Left: SQL Editor ─── */}
      <aside className={styles.editorPane}>
        <header className={`${styles.paneHeader}`}>
          <h1 className={styles.appName}>
            <span className={styles.appNameA}>actually</span>
            <span className={styles.appNameB}>explain</span>
            {/* <span className={styles.appNameC}>.me</span> */}
          </h1>
          <h2 className={styles.sqlFlavor}>PostgreSQL</h2>
          <button className={styles.aboutBtn} onClick={() => setShowAbout(true)} aria-label="About">
            <CircleQuestionMark size={16} />
          </button>
        </header>
        {parseError && (
          <div className={styles.errorBar}>
            <p>{shortenError(parseError)}</p>
          </div>
        )}
        <div className={styles.editorWrapper}>
          <Editor
            defaultLanguage="sql"
            defaultValue={DEFAULT_SQL}
            onChange={handleChange}
            onMount={handleEditorMount}
            theme="actuallyexplain"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'Martian Mono', monospace",
              fontWeight: "475",
              lineHeight: 1.5,
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              lineDecorationsWidth: 0,
              glyphMargin: false,
              padding: { top: 12, bottom: 12 },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              contextmenu: false,
              quickSuggestions: false,
              suggestOnTriggerCharacters: false,
              find: { addExtraSpaceOnTop: false, seedSearchStringFromSelection: 'never' },
            }}
          />
        </div>
      </aside>

      {/* ─── Right: Flow Canvas ─── */}
      <main className={styles.flowPane}>
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
              edgesFocusable={false}
              edgesReconnectable={false}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={2}
              />
              <Controls showInteractive={false} />
            </ReactFlow>
          </NodeActionsContext.Provider>
        </div>
      </main>

      {/* ─── Details overlay (container-level for mobile full-screen) ─── */}
      {selectedNode && (
        <div
          className={styles.detailsOverlay}
          style={{ '--node-color': selectedNode.style?.['--node-color' as keyof typeof selectedNode.style] ?? '#58a6ff' } as React.CSSProperties}
        >
          <NodeDetailsPanel node={selectedNode} onClose={handleClosePanel} isClosing={isClosingPanel} />
        </div>
      )}

      {/* ─── Mobile bottom nav ─── */}
      <nav className={styles.mobileNav}>
        <button
          className={`${styles.mobileNavBtn} ${mobileView === 'editor' ? styles.mobileNavBtnActive : ''}`}
          onClick={() => setMobileView('editor')}
        >
          <Code2 size={20} aria-hidden="true" />
          <span>Code</span>
        </button>
        <button
          className={`${styles.mobileNavBtn} ${mobileView === 'diagram' ? styles.mobileNavBtnActive : ''}`}
          onClick={() => setMobileView('diagram')}
        >
          <Workflow size={20} aria-hidden="true" />
          <span>Diagram</span>
        </button>
      </nav>

      {showAbout && <AboutModal onClose={handleCloseAbout} isClosing={isClosingAbout} />}
    </div>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
      <Analytics />
    </ReactFlowProvider>
  );
}

export default App;
