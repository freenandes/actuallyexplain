import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
  useStoreApi,
  ReactFlowProvider,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parseToGraph } from './parseQuery';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { Analytics } from '@vercel/analytics/react';
import { CircleQuestionMark, Code2, Workflow } from 'lucide-react';
import AboutModal from './AboutModal';
import type { AstLoc } from './buildFlowFromAST';
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

/**
 * The node for a code selection: the smallest node whose range contains all of it. When no node
 * spans the whole selection, the node at its start, so the result doesn't depend on the direction
 * it was made in.
 */
function findNodeForRange(nodes: Node[], start: number, end: number): Node | null {
  return findSmallestContaining(nodes, start, end) ?? (end > start ? findSmallestContaining(nodes, start, start) : null);
}

function findSmallestContaining(nodes: Node[], start: number, end: number): Node | null {
  let best: Node | null = null;
  let bestSize = Infinity;
  for (const n of nodes) {
    const loc = n.data?.loc as AstLoc | undefined;
    if (!loc) continue;
    if (start >= loc.start && end <= loc.end) {
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
  // The default query's diagram is the initial state, so it's ready on the first render.
  const [initial] = useState(() => parseToGraph(DEFAULT_SQL));
  const [nodes, setNodes] = useState<Node[]>(initial.graph?.nodes ?? []);
  const [edges, setEdges] = useState<Edge[]>(initial.graph?.edges ?? []);
  const [parseError, setParseError] = useState<string | null>(initial.error);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isClosingPanel, setIsClosingPanel] = useState(false);
  const [mobileView, setMobileView] = useState<'editor' | 'diagram'>('editor');
  const [appReady, setAppReady] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [isClosingAbout, setIsClosingAbout] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closePanelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeAboutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { fitView, getInternalNode, getViewport, setCenter } = useReactFlow();
  const flowStore = useStoreApi();

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const nodesRef = useRef<Node[]>([]);
  // The diagram still shows the last SQL that parsed, so its ranges don't match the editor text.
  const isStale = parseError !== null && nodes.length > 0;
  const staleRef = useRef(false);
  const suppressCursorRef = useRef(false);
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { staleRef.current = isStale; }, [isStale]);

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

  // Pans the diagram, keeping the zoom, when a node selected from the code isn't fully in view.
  // The details panel covers the right of the canvas, so only the part left of it counts as visible.
  const revealNode = useCallback((id: string) => {
    const node = getInternalNode(id);
    if (!node) return;
    const { width, height } = flowStore.getState();
    // The panel is anchored to the overlay's right edge; offsetWidth ignores its slide-in transform.
    const pane = flowWrapperRef.current?.getBoundingClientRect();
    const overlay = overlayRef.current;
    const panelWidth = (overlay?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
    const panelLeft = overlay ? overlay.getBoundingClientRect().right - panelWidth : Infinity;
    const covered = pane && panelLeft < pane.right ? pane.right - Math.max(panelLeft, pane.left) : 0;
    const visibleWidth = width - covered;
    if (visibleWidth < 120) return; // the panel covers the diagram (mobile)
    const { x: panX, y: panY, zoom } = getViewport();
    const { x, y } = node.internals.positionAbsolute;
    const w = node.measured.width ?? 0;
    const h = node.measured.height ?? 0;
    const left = x * zoom + panX;
    const top = y * zoom + panY;
    if (left >= 0 && top >= 0 && left + w * zoom <= visibleWidth && top + h * zoom <= height) return;
    // setCenter centres on the whole canvas; shift so the node lands in the middle of the visible part.
    setCenter(x + w / 2 + covered / 2 / zoom, y + h / 2, { zoom, duration: 300 });
  }, [getInternalNode, getViewport, setCenter, flowStore]);

  const parseSql = useCallback((raw: string) => {
    clearHighlight();
    const { graph, error } = parseToGraph(raw);
    if (graph) {
      setNodes(graph.nodes);
      setEdges(graph.edges);
    }
    setParseError(error);
  }, [clearHighlight]);

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

    editor.onDidChangeCursorSelection((e) => {
      if (suppressCursorRef.current || staleRef.current) return;
      if (e.reason === 3) {
        // reason 3 = Explicit (click, drag or keyboard)
        const model = editor.getModel();
        if (!model) return;
        const start = model.getOffsetAt(e.selection.getStartPosition());
        const end = model.getOffsetAt(e.selection.getEndPosition());
        const match = findNodeForRange(nodesRef.current, start, end);
        if (match) {
          setHighlightedNodeId(match.id);
          setSelectedNode((prev) => (prev ? match : null)); // an open details panel follows the selection
          const loc = match.data?.loc as AstLoc | undefined;
          if (loc) highlightRange(loc);
          revealNode(match.id);
        } else {
          clearHighlight();
        }
      }
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          setAppReady(true);
          const loader = document.getElementById('app-loader');
          if (loader) {
            loader.classList.add('hiding');
            loader.addEventListener('transitionend', () => loader.remove());
          }
        }, 50);
      });
    });
  }, [highlightRange, clearHighlight, revealNode]);

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    if (staleRef.current) return;
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
    } else {
      decorationsRef.current?.set([]); // no source range: don't leave the previous one highlighted
    }
  }, [highlightRange]);

  // React Flow selects a focused node on Enter / Space without calling onNodeClick, so keyboard
  // selection gets the same code highlight and details-panel behaviour as a click.
  const handleFlowKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return; // the node's info button handles its own keys
    const id = target.closest('.react-flow__node')?.getAttribute('data-id');
    const node = id ? nodesRef.current.find((n) => n.id === id) : undefined;
    if (node) handleNodeClick(e, node);
  }, [handleNodeClick]);

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
    if (staleRef.current) return;
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
    } else {
      decorationsRef.current?.set([]); // no source range: don't leave the previous one highlighted
    }
  }, [highlightRange]);

  // When the details panel opens or switches node, make sure that node isn't hidden behind it.
  useEffect(() => {
    if (selectedNode) revealNode(selectedNode.id);
  }, [selectedNode, revealNode]);

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
          boxShadow: '0 0 16px 6px rgba(90, 189, 172, 0.7)'
        } }
        : n,
    );
  }, [nodes, highlightedNodeId]);

  return (
    <div className={styles.container} data-mobile-view={mobileView} data-ready={appReady}>
      {/* ─── Left: SQL Editor ─── */}
      <aside className={styles.editorPane}>
        <header className={`${styles.paneHeader}`}>
          <h1 className={styles.appName}>
            <span className={styles.appNameA}>actually</span>
            <span className={styles.appNameB}>explain</span>
          </h1>
          <h2 className={styles.sqlFlavor}>PostgreSQL logical intent</h2>
          <div className={styles.actions}>
            <button className={styles.aboutBtn} onClick={() => setShowAbout(true)} aria-label="About">
              <CircleQuestionMark size={18} />
            </button>
          </div>
        </header>
        {parseError && (
          <div className={styles.errorBar}>
            <p>{parseError}</p>
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
      <main className={styles.flowPane} data-stale={isStale}>
        {parseError && (
          <div className={styles.staleBanner} data-stale={isStale} role="status">
            {isStale && <span>Out of date: showing the last SQL that parsed. </span>}
            {/* The editor's error bar shows this on desktop; Diagram view on mobile hides the editor. */}
            <span className={styles.staleBannerError}>{parseError}</span>
          </div>
        )}
        <div className={styles.flowWrapper} ref={flowWrapperRef} onKeyDown={handleFlowKeyDown}>
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
              deleteKeyCode={null} // the diagram is derived from the SQL; nothing can be removed from it
              elementsSelectable={!isStale}
              nodesFocusable={!isStale}
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
          ref={overlayRef}
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
