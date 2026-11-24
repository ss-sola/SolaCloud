import type { MethodGraph, MethodNode } from '../api/apiCallGraph';

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Family = { owner: MethodNode; count: number; bounds: Bounds };
type Slot = Point & { heading: number };
const circle = 2 * Math.PI;
const turnOffsets = [0, -0.42, 0.42, -0.84, 0.84, -1.3, 1.3, -1.9, 1.9, Math.PI];

function boundsOf(points: Point[]): Bounds {
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const p of points) {
    bounds.left = Math.min(bounds.left, p.x);
    bounds.right = Math.max(bounds.right, p.x);
    bounds.top = Math.min(bounds.top, p.y);
    bounds.bottom = Math.max(bounds.bottom, p.y);
  }
  return bounds;
}

// Normalized coordinates keep the same family shapes for different card sizes.
// Allocate siblings on successive arcs centered on their own caller.
function familySlots(size: number, heading: number, open: boolean): Slot[] {
  const slots: Slot[] = [];
  const sweep = open ? circle : Math.min(Math.PI * 0.97, 0.92 * (size - 1));
  for (let ring = 0; slots.length < size; ring++) {
    const radius = (open ? 1.62 : 1.55) + 1.49 * ring;
    const capacity = Math.max(1, Math.floor((sweep * radius) / 1.46) + (open ? 0 : 1));
    const count = Math.min(capacity, size - slots.length);
    for (let i = 0; i < count; i++) {
      const angle = open
        ? heading + (circle * (i + (ring % 2) * 0.37)) / count
        : heading + (count > 1 ? (i / (count - 1) - 0.5) * sweep : 0);
      slots.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), heading: angle });
    }
  }
  return slots;
}

function intersects(a: Bounds, b: Bounds) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Primary ownership affects placement only. Other callers and recursive edges
 * retain the very same destination. A family is moved together so another
 * branch cannot take the space between a method's own downstream methods. */
export function layoutCallBranches(
  layers: MethodNode[][],
  edges: MethodGraph['edges'],
  card: { width: number; height: number; compact: boolean },
) {
  const level = new Map<string, number>();
  const nodes = new Map<string, MethodNode>();
  for (const [depth, layer] of layers.entries())
    for (const node of layer) {
      level.set(node.id, depth);
      nodes.set(node.id, node);
    }
  const owners = new Map<string, string>();
  for (const { from, to } of edges) {
    const caller = nodes.get(from),
      callee = nodes.get(to);
    if (!caller || !callee || level.get(from)! + 1 !== level.get(to)) continue;
    const previous = owners.get(to);
    if (!previous || (caller.file === callee.file && nodes.get(previous)!.file !== callee.file))
      owners.set(to, from);
  }
  const families = new Map<string | undefined, MethodNode[]>();
  for (const node of nodes.values()) {
    const owner = owners.get(node.id);
    const family = families.get(owner);
    if (family) family.push(node);
    else families.set(owner, [node]);
  }
  const roots = families.get(undefined) ?? [];
  const located = new Map<string, Slot>();
  const groups: Family[] = [];
  const occupied: Bounds[] = [];
  // Half-width / height of a reserved slot include clearance for routed edges.
  const half = 0.54;
  const stepX = card.width + (card.compact ? 37 : 49);
  const stepY = card.height + (card.compact ? 35 : 50);
  const origin: Slot = { x: 0, y: 0, heading: -Math.PI / 2 - 0.14 };
  function slotBounds(slot: Point) {
    return { left: slot.x - half, right: slot.x + half, top: slot.y - half, bottom: slot.y + half };
  }
  function reserveFamily(
    owner: MethodNode | undefined,
    children: MethodNode[],
    center: Slot,
    open: boolean,
  ) {
    // Use a named island for substantial fan-outs. Small chains follow their
    // parent's direction without the cost of a group label or enclosing box.
    const named = !!owner && !open && (children.length >= 4 || level.get(owner.id) === 1);
    const regionFor = (slots: Slot[]) => {
      const box = boundsOf(slots);
      return {
        left: box.left - half,
        right: box.right + half,
        top: box.top - half - 0.27,
        bottom: box.bottom + half,
      };
    };
    // Try nearby branch directions before increasing the distance from the
    // parent. Rotations are precomputed and shared by all distance trials.
    const candidates = (open ? [0] : turnOffsets).map((turn) => {
      const heading = center.heading + turn;
      const slots = familySlots(children.length, heading, open);
      return { heading, slots, bounds: regionFor(slots) };
    });
    for (let distance = 0; ; distance += 0.78) {
      for (const candidate of candidates) {
        const x = center.x + distance * Math.cos(candidate.heading);
        const y = center.y + distance * Math.sin(candidate.heading);
        const box = {
          left: candidate.bounds.left + x,
          top: candidate.bounds.top + y,
          right: candidate.bounds.right + x,
          bottom: candidate.bounds.bottom + y,
        };
        const nearby = occupied.filter((other) => intersects(box, other));
        if (named && nearby.length) continue;
        const slots = candidate.slots.map((slot) => ({
          x: slot.x + x,
          y: slot.y + y,
          heading: slot.heading,
        }));
        if (
          !named &&
          nearby.length &&
          slots.some((slot) => nearby.some((other) => intersects(slotBounds(slot), other)))
        )
          continue;
        slots.forEach((slot, i) => located.set(children[i].id, slot));
        if (named) {
          groups.push({ owner, count: children.length, bounds: box });
          occupied.push(box);
        } else occupied.push(...slots.map(slotBounds));
        return;
      }
    }
  }
  if (roots.length === 1) {
    located.set(roots[0].id, origin);
    occupied.push(slotBounds(origin));
  } else if (roots.length) reserveFamily(undefined, roots, origin, true);
  for (const layer of layers)
    for (const node of layer) {
      const children = families.get(node.id);
      if (children)
        reserveFamily(
          node,
          children,
          located.get(node.id)!,
          roots.length === 1 && node === roots[0],
        );
    }
  const extent = boundsOf(
    occupied.flatMap((b) => [
      { x: b.left, y: b.top },
      { x: b.right, y: b.bottom },
    ]),
  );
  const padding = 24;
  const scaleX = (x: number) => Math.round((x - extent.left) * stepX) + padding;
  const scaleY = (y: number) => Math.round((y - extent.top) * stepY) + padding;
  const positions = new Map<string, Point & { node: MethodNode }>();
  for (const [id, p] of located)
    positions.set(id, {
      node: nodes.get(id)!,
      x: scaleX(p.x) - card.width / 2,
      y: scaleY(p.y) - card.height / 2,
    });
  return {
    owners,
    groups: groups.map(({ owner, count, bounds: b }) => ({
      owner,
      count,
      x: scaleX(b.left),
      y: scaleY(b.top),
      width: scaleX(b.right) - scaleX(b.left),
      height: scaleY(b.bottom) - scaleY(b.top),
    })),
    positions,
    width: scaleX(extent.right) + padding,
    height: scaleY(extent.bottom) + padding,
    cardWidth: card.width,
    cardHeight: card.height,
    compact: card.compact,
    horizontal: false,
    rowGap: stepY - card.height,
  };
}
