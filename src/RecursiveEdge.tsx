import { BaseEdge, type EdgeProps } from '@xyflow/react';

/**
 * Custom edge that draws a smooth loop around the right side of the graph.
 * Used for recursive CTE feedback edges — hidden from dagre to avoid cycles,
 * but rendered visually as a distinct dashed curve.
 *
 * Expects `data.fromX`, `data.fromY`, `data.toX`, `data.toY`, `data.loopX`
 * pre-computed by GraphBuilder.layout().
 */
export default function RecursiveEdge({
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const fromX = (data?.fromX as number) ?? 0;
  const fromY = (data?.fromY as number) ?? 0;
  const toX = (data?.toX as number) ?? 0;
  const toY = (data?.toY as number) ?? 0;
  const loopX = (data?.loopX as number) ?? Math.max(fromX, toX) + 120;

  const path = [
    `M ${fromX},${fromY}`,
    `C ${loopX},${fromY} ${loopX},${toY} ${toX},${toY}`,
  ].join(' ');

  return <BaseEdge path={path} style={style} markerEnd={markerEnd} />;
}
