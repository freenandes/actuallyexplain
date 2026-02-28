import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Database,
  Link,
  Filter,
  LayoutList,
  Rows4,
  ArrowUpDown,
  Repeat,
  Trash2,
  SquarePlus,
  Pencil,
  Scissors,
  GitMerge,
  PenLine,
  CornerDownLeft,
  Settings,
  Hammer,
  Columns3,
  Crosshair,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { NodeActionsContext } from './NodeActionsContext';
import styles from './SqlNode.module.css';

const kindIcons: Record<string, LucideIcon> = {
  table: Database,
  join: Link,
  where: Filter,
  having: Filter,
  select: LayoutList,
  groupby: Rows4,
  orderby: ArrowUpDown,
  limit: Scissors,
  cte: Repeat,
  union: GitMerge,
  values: Database,
  insert: SquarePlus,
  update: Pencil,
  delete: Trash2,
  create: Hammer,
  column: Columns3,
  set: PenLine,
  returning: CornerDownLeft,
  operation: Settings,
  target: Crosshair,
};

export default function SqlNode({ id, data }: NodeProps) {
  const kind = (data.kind as string) ?? 'operation';
  const Icon = kindIcons[kind] ?? Settings;
  const { openDetails } = useContext(NodeActionsContext);

  return (
    <>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <Icon size={12} />
          <span className={styles.rawCode}>{data.label as string}</span>
          <button
            className={styles.infoBtn}
            title="Open details panel"
            onClick={(e) => { e.stopPropagation(); openDetails(id); }}
          >
            <Info size={12} />
          </button>
        </div>
        <div className={styles.body}>{data.plainEnglish as string}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </>
  );
}
