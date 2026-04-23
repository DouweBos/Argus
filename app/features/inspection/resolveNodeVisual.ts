import type { Capture, HierarchyNode, NodeVisual } from "./types";

/** Round a frame coordinate to 2 decimals, stripping trailing zeros. */
export function fmtCoord(n: number): string {
  if (!Number.isFinite(n)) {
    return "0";
  }
  const rounded = Math.round(n * 100) / 100;

  return String(rounded);
}

/**
 * Native types that are intrinsically "visible leaves" — their frame alone
 * represents the pixels on screen, so we can crop the composite screenshot to
 * get a faithful per-node thumbnail. Container views (`UIView`,
 * `android.view.ViewGroup`, generic `<div>`) instead render as outlines.
 */
const VISIBLE_LEAF_TYPES = new Set([
  "UIImageView",
  "UILabel",
  "UIButton",
  "UITextField",
  "UITextView",
  "UISwitch",
  "android.widget.TextView",
  "android.widget.ImageView",
  "android.widget.Button",
  "android.widget.EditText",
  "android.widget.ImageButton",
  "img",
  "input",
  "button",
  "textarea",
  "select",
  "a",
]);

function hasDirectText(node: HierarchyNode): boolean {
  return Boolean(
    (node.label && node.label.trim().length > 0) ||
    (node.value && node.value.trim().length > 0),
  );
}

export function isVisibleLeaf(node: HierarchyNode): boolean {
  if (VISIBLE_LEAF_TYPES.has(node.type)) {
    return true;
  }
  if (node.children.length === 0 && hasDirectText(node)) {
    return true;
  }

  return node.children.length === 0;
}

/**
 * Decide how a single node should be rendered in the 2D overlay.
 *
 * Extension seam: when `capabilities.perViewPixels` flips to `true` in a
 * future capture, individual nodes can ship their own `pixelSource` and the
 * renderer will use that instead of cropping from the composite screenshot.
 */
export function resolveNodeVisual(
  node: HierarchyNode,
  capture: Capture,
): NodeVisual {
  if (
    capture.capabilities.perViewPixels &&
    node.pixelSource?.kind === "image"
  ) {
    return { kind: "image", url: node.pixelSource.url };
  }
  if (isVisibleLeaf(node)) {
    return { kind: "crop", bounds: node.frame };
  }

  return { kind: "outline" };
}

/** Depth-first flatten — the renderer iterates this list to draw outlines. */
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
 * Returns the chain of nodes from `root` down to `id` (inclusive). Empty when
 * the id isn't in the tree.
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
 * Case-insensitive match of a node's type, label, identifier, value, or hint
 * against a free-text query. Empty / whitespace-only queries match nothing.
 */
export function matchesSearch(node: HierarchyNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return false;
  }
  const fields = [
    node.type,
    node.label,
    node.identifier,
    node.value,
    node.hint,
  ];
  for (const field of fields) {
    if (field && field.toLowerCase().includes(q)) {
      return true;
    }
  }

  return false;
}

/**
 * Flatten the tree in visual (depth-first) order, returning only nodes that
 * match the query. Used to drive next/prev navigation.
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
 * Returns every node whose frame contains the given point, in depth-first
 * order (outer-first). Walks the whole tree unconditionally — we can't
 * prune by ancestor containment because some containers legitimately have
 * zero frames (iOS's XCUI Application root, certain layout wrappers) while
 * their descendants have real coordinates.
 */
export function nodesContainingPoint(
  root: HierarchyNode,
  x: number,
  y: number,
): HierarchyNode[] {
  const hits: HierarchyNode[] = [];
  const contains = (node: HierarchyNode): boolean => {
    const { frame } = node;
    if (frame.w <= 0 || frame.h <= 0) {
      return false;
    }

    return (
      x >= frame.x &&
      x <= frame.x + frame.w &&
      y >= frame.y &&
      y <= frame.y + frame.h
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
