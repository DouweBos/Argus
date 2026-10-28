/** A trimmed node tree, flattened into the rows the design viewer lists. */

import type { TrimmedNode } from "./client";
import type { FigmaLayer } from "@argus/remote-protocol";

const MAX_LAYERS = 400;

function hex(channel: number): string {
  return Math.round(Math.max(0, Math.min(1, channel)) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** The first visible solid fill as `#rrggbb`. */
export function solidFill(fills: unknown): string | null {
  if (!Array.isArray(fills)) {
    return null;
  }
  for (const fill of fills as {
    type?: string;
    visible?: boolean;
    color?: { r: number; g: number; b: number };
  }[]) {
    if (fill.type === "SOLID" && fill.visible !== false && fill.color) {
      return `#${hex(fill.color.r)}${hex(fill.color.g)}${hex(fill.color.b)}`;
    }
  }

  return null;
}

function font(style: Record<string, unknown> | undefined): string | null {
  if (!style?.fontFamily) {
    return null;
  }
  const size = style.fontSize ? ` ${String(style.fontSize)}` : "";
  const line = style.lineHeightPx
    ? `/${Math.round(Number(style.lineHeightPx))}`
    : "";

  return `${String(style.fontFamily)} ${String(style.fontWeight ?? "")}${size}${line}`.replace(
    /\s+/g,
    " ",
  );
}

export function flattenLayers(root: TrimmedNode): FigmaLayer[] {
  const rows: FigmaLayer[] = [];
  const walk = (node: TrimmedNode, depth: number) => {
    if (rows.length >= MAX_LAYERS) {
      return;
    }
    rows.push({
      id: node.id,
      name: node.name,
      type: node.type,
      depth,
      width: node.size?.w ?? null,
      height: node.size?.h ?? null,
      text: node.text ?? null,
      fill: solidFill(node.fills),
      font: font(node.style),
    });
    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  };
  walk(root, 0);

  return rows;
}

/** Icons and images an agent should export rather than redraw. */
export function exportableNodes(root: TrimmedNode): TrimmedNode[] {
  const found: TrimmedNode[] = [];
  const walk = (node: TrimmedNode, depth: number) => {
    const small = (node.size?.w ?? 999) <= 64 && (node.size?.h ?? 999) <= 64;
    const vector = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON"].includes(
      node.type,
    );
    const component = ["INSTANCE", "COMPONENT"].includes(node.type);
    if (depth > 0 && small && (vector || component)) {
      found.push(node);

      return;
    }
    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  };
  walk(root, 0);

  return found.slice(0, 40);
}
