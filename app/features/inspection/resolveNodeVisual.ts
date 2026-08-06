import type { Frame, HierarchyNode, NodeVisual } from "./types";

/** Round a coordinate to 2 decimals, stripping trailing zeros. */
export function fmtCoord(n: number): string {
  if (!Number.isFinite(n)) {
    return "0";
  }
  const rounded = Math.round(n * 100) / 100;

  return String(rounded);
}

/**
 * The rect to draw a node at on the overlay. `native-inspect`'s `frame` is
 * superview-local; `absFrame` is window-absolute, which is what the overlay
 * (and the future 3D plane) needs. Falls back to `frame` for the window roots,
 * whose local frame already is window-absolute.
 */
export function nodeRect(node: HierarchyNode): Frame {
  return node.absFrame ?? node.frame;
}

/** A node with no children draws its own pixels; containers draw as outlines. */
export function isVisibleLeaf(node: HierarchyNode): boolean {
  return node.children.length === 0;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * A short, human-recognisable tag for a node beyond its class — the thing that
 * lets you pick it out of a list of identical `RCTViewComponentView`s. Falls
 * through text → accessibility label → identifier/testID/nativeID → image asset
 * → non-transparent background color. Returns undefined when nothing
 * distinguishing is available. Pass `maxLength: Infinity` for the full,
 * untruncated string (e.g. a hover tooltip).
 */
export function nodeHint(
  node: HierarchyNode,
  maxLength = 32,
): string | undefined {
  const text = (node.text ?? node.title ?? node.accessibilityLabel)?.trim();
  if (text) {
    return `"${truncate(text, maxLength)}"`;
  }
  const id =
    node.accessibilityIdentifier ?? node.rn?.testID ?? node.rn?.nativeID;
  if (id) {
    return `#${truncate(id, maxLength)}`;
  }
  if (node.image?.name) {
    return `img:${truncate(node.image.name, maxLength)}`;
  }
  // A solid fill is at least a visual cue for otherwise-anonymous wrappers;
  // skip fully-transparent colors (alpha 00), which tell you nothing.
  if (
    node.backgroundColor &&
    !node.backgroundColor.toUpperCase().endsWith("00")
  ) {
    return node.backgroundColor;
  }

  return undefined;
}

/**
 * Decide how a node draws in the 2D overlay. With real `backgroundColor` from
 * the layer we tint the box; otherwise it's a plain outline. `image` (a
 * per-node `native-snapshot` texture) is the seam a 3D viewer slots into.
 */
export function resolveNodeVisual(node: HierarchyNode): NodeVisual {
  if (node.backgroundColor) {
    return { kind: "fill", color: node.backgroundColor };
  }

  return { kind: "outline" };
}

/** Depth-first flatten — the renderer iterates this to draw boxes. */
export function flattenHierarchy(root: HierarchyNode): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  const walk = (node: HierarchyNode) => {
    out.push(node);
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(root);

  return out;
}

export function findNodeById(
  root: HierarchyNode,
  id: string,
): HierarchyNode | null {
  if (root.id === id) {
    return root;
  }
  for (const child of root.children) {
    const hit = findNodeById(child, id);
    if (hit) {
      return hit;
    }
  }

  return null;
}

/**
 * Chain of nodes from `root` down to `id` (inclusive). Empty when the id isn't
 * in the tree.
 */
export function pathToNode(root: HierarchyNode, id: string): HierarchyNode[] {
  const stack: HierarchyNode[] = [];
  const walk = (node: HierarchyNode): boolean => {
    stack.push(node);
    if (node.id === id) {
      return true;
    }
    for (const child of node.children) {
      if (walk(child)) {
        return true;
      }
    }
    stack.pop();

    return false;
  };
  walk(root);

  return stack;
}

/**
 * child-id → parent-id map. Node ids from `native-inspect` are opaque pointers
 * (not dotted paths), so ancestry can't be derived from the id string — the
 * tree walk gives it instead.
 */
export function buildParentMap(root: HierarchyNode): Map<string, string> {
  const parents = new Map<string, string>();
  const walk = (node: HierarchyNode) => {
    for (const child of node.children) {
      parents.set(child.id, node.id);
      walk(child);
    }
  };
  walk(root);

  return parents;
}

/** Strict-ancestor ids of `id` (excluding `id` itself), outermost last. */
export function ancestorIds(
  parents: Map<string, string>,
  id: string,
): string[] {
  const out: string[] = [];
  let cursor = parents.get(id);
  while (cursor !== undefined) {
    out.push(cursor);
    cursor = parents.get(cursor);
  }

  return out;
}

/** Union of every id in `ids` plus all their strict ancestors. */
export function collectVisibleIds(
  parents: Map<string, string>,
  ids: Iterable<string>,
): Set<string> {
  const set = new Set<string>();
  for (const id of ids) {
    set.add(id);
    for (const ancestor of ancestorIds(parents, id)) {
      set.add(ancestor);
    }
  }

  return set;
}

/**
 * Case-insensitive match of a node's class, text, identifiers, or accessibility
 * label against a free-text query. Empty / whitespace-only queries match nothing.
 */
export function matchesSearch(node: HierarchyNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return false;
  }
  const fields = [
    node.class,
    node.text,
    node.title,
    node.placeholder,
    node.accessibilityLabel,
    node.accessibilityIdentifier,
    node.rn?.testID,
    node.rn?.nativeID,
  ];
  for (const field of fields) {
    if (field && field.toLowerCase().includes(q)) {
      return true;
    }
  }

  return false;
}

/**
 * Flatten in visual (depth-first) order, keeping only nodes that match. Drives
 * next/prev search navigation.
 */
export function findSearchMatches(
  root: HierarchyNode,
  query: string,
): HierarchyNode[] {
  if (query.trim().length === 0) {
    return [];
  }
  const hits: HierarchyNode[] = [];
  const walk = (node: HierarchyNode) => {
    if (matchesSearch(node, query)) {
      hits.push(node);
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(root);

  return hits;
}

/**
 * Every node whose on-screen rect contains the point, depth-first (outer-first).
 * Walks the whole tree unconditionally — some containers legitimately have zero
 * frames while their descendants have real coordinates.
 */
export function nodesContainingPoint(
  root: HierarchyNode,
  x: number,
  y: number,
): HierarchyNode[] {
  const hits: HierarchyNode[] = [];
  const contains = (node: HierarchyNode): boolean => {
    const rect = nodeRect(node);
    if (rect.w <= 0 || rect.h <= 0) {
      return false;
    }

    return (
      x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
    );
  };
  const walk = (node: HierarchyNode) => {
    if (contains(node)) {
      hits.push(node);
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(root);

  return hits;
}
