import { useCallback, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Editor from '@monaco-editor/react';
import styles from './App.module.css';

const DEFAULT_SQL = `SELECT
  u.id,
  u.name,
  o.total
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.total > 100
ORDER BY o.total DESC;`;

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'default',
    position: { x: 80, y: 100 },
    data: { label: 'SELECT u.id, u.name, o.total' },
    style: {
      background: '#1c2129',
      color: '#e6edf3',
      border: '1px solid #58a6ff',
      borderRadius: 8,
      padding: '10px 16px',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
    },
  },
  {
    id: '2',
    type: 'default',
    position: { x: 60, y: 260 },
    data: { label: 'FROM users u JOIN orders o' },
    style: {
      background: '#1c2129',
      color: '#e6edf3',
      border: '1px solid #3fb950',
      borderRadius: 8,
      padding: '10px 16px',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
    },
  },
];

const initialEdges: Edge[] = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    animated: true,
    style: { stroke: '#58a6ff' },
  },
];

function App() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [sql, setSql] = useState(DEFAULT_SQL);

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
        </div>
        <div className={styles.editorWrapper}>
          <Editor
            defaultLanguage="sql"
            value={sql}
            onChange={(value) => setSql(value ?? '')}
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
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
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

export default App;
