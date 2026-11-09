import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Settings, Info } from 'lucide-react';
import { NodeActionsContext } from './NodeActionsContext';
import { kindIcons } from './kindIcons';
import styles from './SqlNode.module.css';

export default function SqlNode({ id, data }: NodeProps) {
  const kind = (data.kind as string) ?? 'operation';
  const Icon = kindIcons[kind] ?? kindIcons.operation ?? Settings;
  const { openDetails } = useContext(NodeActionsContext);

  return (
    <>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <Icon size={16} />
          <span className={styles.rawCode}>{data.label as string}</span>
          <button
            className={styles.infoBtn}
            title="Open details panel"
            onClick={(e) => { e.stopPropagation(); openDetails(id); }}
          >
            <Info size={16} />
          </button>
        </div>
        <p className={styles.body}>{data.plainEnglish as string}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </>
  );
}
