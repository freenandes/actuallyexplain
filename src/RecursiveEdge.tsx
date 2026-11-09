import { BaseEdge, type EdgeProps, type XYPosition } from '@xyflow/react';

const CORNER_RADIUS = 12;

const distance = (a: XYPosition, b: XYPosition) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Custom edge for recursive CTE feedback loops — hidden from dagre to avoid cycles, but rendered
 * visually as a distinct dashed path. It follows the waypoints GraphBuilder.layout() computes
 * (`data.points`): through the gaps between ranks and around the right side of the graph, so it
 * never runs behind other nodes. Corners are rounded.
 */
export default function RecursiveEdge({
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const points = (data?.points as XYPosition[] | undefined) ?? [];
  if (points.length < 2) return null;

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
