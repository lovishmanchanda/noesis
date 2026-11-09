import type { TreeNodeView } from '../../training/events';

const NODE_W = 72;
const NODE_H = 34;
const GAP_X = 8;
const GAP_Y = 22;

interface Placed extends TreeNodeView {
  x: number;
  y: number;
}

/** Places nodes: leaves left to right, parents centred over their children. */
function place(nodes: TreeNodeView[]): { placed: Placed[]; width: number; height: number } {
  const children = new Map<number, TreeNodeView[]>();
  for (const n of nodes)
    if (n.parentId !== null) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const positions = new Map<number, number>();
  let leaf = 0;
  const walk = (n: TreeNodeView): number => {
    const kids = (children.get(n.nodeId) ?? []).filter((k) => byId.has(k.nodeId));
    if (kids.length === 0) {
      const at = leaf++;
      positions.set(n.nodeId, at);
      return at;
    }
    const spots = kids.map(walk);
    const centre = (Math.min(...spots) + Math.max(...spots)) / 2;
    positions.set(n.nodeId, centre);
    return centre;
  };
  const root = nodes.find((n) => n.parentId === null);
  if (root) walk(root);
  const placed = nodes
    .filter((n) => positions.has(n.nodeId))
    .map((n) => ({
      ...n,
      x: (positions.get(n.nodeId) as number) * (NODE_W + GAP_X),
      y: n.depth * (NODE_H + GAP_Y),
    }));
  const maxDepth = Math.max(0, ...placed.map((n) => n.depth));
  return {
    placed,
    width: Math.max(1, leaf) * (NODE_W + GAP_X),
    height: (maxDepth + 1) * (NODE_H + GAP_Y),
  };
}

const short = (v: number | null): string =>
  v === null ? '' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
const leafValue = (n: TreeNodeView): string => {
  const v = n.value;
  if (v.length === 1) return short(v[0] ?? null);
  const top = v.indexOf(Math.max(...v));
  return `class ${top}`;
};

/**
 * One tree of the forest, drawn node by node as it was built. The nodes below the sixth level are
 * summarised, not drawn. The tree is replayed from the finished model, so it is labelled so.
 */
export function TreeView({
  nodes: all,
  summary,
  levels = 4,
}: {
  nodes: TreeNodeView[];
  /** How many levels to draw. Deeper ones are in the summary only, so the picture stays readable. */
  levels?: number;
  summary?: { nodes: number; depth: number; leaves: number } | undefined;
}) {
  const nodes = all.filter((n) => n.depth < levels);
  if (nodes.length === 0) return <p className="muted">The tree appears when training ends.</p>;
  const { placed, width, height } = place(nodes);
  const byId = new Map(placed.map((n) => [n.nodeId, n]));
  return (
    <figure className="chart tree">
      <svg
        viewBox={`-4 -4 ${width + 8} ${height + 8}`}
        role="img"
        aria-label={`Decision tree with ${summary?.nodes ?? nodes.length} nodes and ${summary?.leaves ?? ''} leaves`}
        style={{ minWidth: Math.min(width, 900) }}
      >
        {placed.map((n) => {
          const parent = n.parentId === null ? undefined : byId.get(n.parentId);
          return parent ? (
            <line
              key={`e${n.nodeId}`}
              x1={parent.x + NODE_W / 2}
              y1={parent.y + NODE_H}
              x2={n.x + NODE_W / 2}
              y2={n.y}
              className="tree-edge"
            />
          ) : null;
        })}
        {placed.map((n) => (
          <g key={n.nodeId} transform={`translate(${n.x},${n.y})`}>
            <rect
              width={NODE_W}
              height={NODE_H}
              rx={5}
              className={n.isLeaf ? 'tree-leaf' : 'tree-node'}
            />
            <text x={NODE_W / 2} y={14} textAnchor="middle" className="tree-text">
              {n.isLeaf ? leafValue(n) : `${(n.feature ?? '').slice(0, 9)} ≤ ${short(n.threshold)}`}
            </text>
            <text x={NODE_W / 2} y={27} textAnchor="middle" className="tree-sub">
              {n.samples} rows
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="muted small">
        {summary
          ? `Top ${levels} levels of ${summary.nodes} nodes (${summary.leaves} leaves, ${summary.depth} levels deep). `
          : ''}
        <span className="replay-tag">replay of the learned structure</span>
      </figcaption>
    </figure>
  );
}
