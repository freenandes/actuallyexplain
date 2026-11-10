import { BaseEdge, useInternalNode, type EdgeProps, type XYPosition } from '@xyflow/react';

const CORNER_RADIUS = 12;

const distance = (a: XYPosition, b: XYPosition) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Custom edge for recursive CTE feedback loops — hidden from dagre to avoid cycles, but rendered
 * visually as a distinct dashed path with rounded corners. It runs out of the CTE node's right
 * side, through the gap above its rank, around the right of the graph and back through the gap
 * below the target's rank. The route is computed from the nodes' current positions, so it stays
 * attached when they're dragged; GraphBuilder.layout() supplies the gaps (`data.exitAbove`,
 * `data.entryBelow`), the outer lane (`data.loopX`) and the side offset (`data.side`).
 */
export default function RecursiveEdge({
  source,
  target,
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const src = useInternalNode(source);
  const tgt = useInternalNode(target);
  if (!src?.measured.width || !src.measured.height || !tgt?.measured.width || !tgt.measured.height) return null;

  const side = (data?.side as number) ?? 20;
  const s = src.internals.positionAbsolute;
  const t = tgt.internals.positionAbsolute;
  const fromX = s.x + src.measured.width;
  const fromY = s.y + src.measured.height / 2;
  const toX = t.x + tgt.measured.width;
  const toY = t.y + tgt.measured.height / 2;
  const exitY = s.y - ((data?.exitAbove as number) ?? 60);
  const entryY = t.y + tgt.measured.height + ((data?.entryBelow as number) ?? 60);
  const loopX = Math.max((data?.loopX as number) ?? 0, fromX + 2 * side, toX + 2 * side);

  const points: XYPosition[] = [
    { x: fromX, y: fromY },
    { x: fromX + side, y: fromY },
    { x: fromX + side, y: exitY },
    { x: loopX, y: exitY },
    { x: loopX, y: entryY },
    { x: toX + side, y: entryY },
    { x: toX + side, y: toY },
    { x: toX, y: toY },
  ];

  let path = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, corner, next] = [points[i - 1], points[i], points[i + 1]];
    const r = Math.min(CORNER_RADIUS, distance(prev, corner) / 2, distance(corner, next) / 2);
    path += ` L ${corner.x + Math.sign(prev.x - corner.x) * r},${corner.y + Math.sign(prev.y - corner.y) * r}`;
    path += ` Q ${corner.x},${corner.y} ${corner.x + Math.sign(next.x - corner.x) * r},${corner.y + Math.sign(next.y - corner.y) * r}`;
  }
  const end = points[points.length - 1];
  path += ` L ${end.x},${end.y}`;

  return <BaseEdge path={path} style={style} markerEnd={markerEnd} />;
}
