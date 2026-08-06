/**
 * Turn the raw `native-inspect` bundle into the `Capture` the renderer consumes.
 *
 * `native-inspect` already returns a single, typed Apple view tree, so — unlike
 * the old multi-platform `capture-ui` normalizer — there is no heterogeneity to
 * collapse. This module only: wraps the `windows[]` array into one root, fills
 * defaults defensively (so a partial/garbled payload shows the empty state
 * instead of crashing), and guarantees every node has a `children` array.
 */

import type {
  Capture,
  CaptureDevice,
  Frame,
  HierarchyNode,
  RawCapture,
} from "./types";

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return v === true ? true : undefined;
}

function frame(source: unknown): Frame {
  const raw = (source ?? {}) as Record<string, unknown>;

  return {
    x: num(raw.x) ?? 0,
    y: num(raw.y) ?? 0,
    w: num(raw.w) ?? 0,
    h: num(raw.h) ?? 0,
  };
}

function optionalFrame(source: unknown): Frame | undefined {
  return source && typeof source === "object" ? frame(source) : undefined;
}

function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) {
    return undefined;
  }
  const out = v.filter((x): x is string => typeof x === "string");

  return out.length > 0 ? out : undefined;
}

function numberArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) {
    return undefined;
  }
  const out = v.filter((x): x is number => typeof x === "number");

  return out.length > 0 ? out : undefined;
}

function font(v: unknown): HierarchyNode["font"] {
  if (!v || typeof v !== "object") {
    return undefined;
  }
  const raw = v as Record<string, unknown>;

  return {
    name: str(raw.name) ?? "",
    family: str(raw.family) ?? "",
    size: num(raw.size) ?? 0,
    bold: bool(raw.bold),
    italic: bool(raw.italic),
    weight: num(raw.weight),
  };
}

function reactInfo(v: unknown): HierarchyNode["rn"] {
  if (!v || typeof v !== "object") {
    return undefined;
  }
  const raw = v as Record<string, unknown>;
  const rn = {
    reactTag: str(raw.reactTag),
    nativeID: str(raw.nativeID),
    testID: str(raw.testID),
  };

  return rn.reactTag || rn.nativeID || rn.testID ? rn : undefined;
}

function image(v: unknown): HierarchyNode["image"] {
  if (!v || typeof v !== "object") {
    return undefined;
  }
  const raw = v as Record<string, unknown>;

  return {
    w: num(raw.w) ?? 0,
    h: num(raw.h) ?? 0,
    scale: num(raw.scale) ?? 1,
    name: str(raw.name),
  };
}

function anchor(v: unknown): HierarchyNode["anchorPoint"] {
  if (!v || typeof v !== "object") {
    return undefined;
  }
  const raw = v as Record<string, unknown>;
  const x = num(raw.x);
  const y = num(raw.y);

  return x !== undefined && y !== undefined ? { x, y } : undefined;
}

function normalizeNode(
  raw: Record<string, unknown>,
  depth: number,
): HierarchyNode {
  const children: HierarchyNode[] = [];
  if (Array.isArray(raw.children)) {
    for (const child of raw.children) {
      if (child && typeof child === "object") {
        children.push(
          normalizeNode(child as Record<string, unknown>, depth + 1),
        );
      }
    }
  }

  return {
    id: str(raw.id) ?? `node_${depth}_${children.length}`,
    class: str(raw.class) ?? "UIView",
    frame: frame(raw.frame),
    absFrame: optionalFrame(raw.absFrame),
    depth: num(raw.depth) ?? depth,
    z: num(raw.z),
    alpha: num(raw.alpha),
    hidden: bool(raw.hidden),
    accessibilityIdentifier: str(raw.accessibilityIdentifier),
    accessibilityLabel: str(raw.accessibilityLabel),
    backgroundColor: str(raw.backgroundColor),
    textColor: str(raw.textColor),
    tintColor: str(raw.tintColor),
    titleColor: str(raw.titleColor),
    text: typeof raw.text === "string" ? raw.text : undefined,
    title: typeof raw.title === "string" ? raw.title : undefined,
    placeholder: str(raw.placeholder),
    font: font(raw.font),
    image: image(raw.image),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    cornerRadius: num(raw.cornerRadius),
    maskedCorners: num(raw.maskedCorners),
    masksToBounds: bool(raw.masksToBounds),
    borderWidth: num(raw.borderWidth),
    borderColor: str(raw.borderColor),
    shadowOpacity: num(raw.shadowOpacity),
    shadowRadius: num(raw.shadowRadius),
    shadowColor: str(raw.shadowColor),
    gradientColors: stringArray(raw.gradientColors),
    transform3D: numberArray(raw.transform3D),
    anchorPoint: anchor(raw.anchorPoint),
    hasMask: bool(raw.hasMask),
    rn: reactInfo(raw.rn),
    truncated: num(raw.truncated),
    children,
  };
}

function syntheticRoot(
  children: HierarchyNode[],
  device: CaptureDevice,
): HierarchyNode {
  return {
    id: "windows",
    class: "Windows",
    frame: { x: 0, y: 0, w: device.width, h: device.height },
    absFrame: { x: 0, y: 0, w: device.width, h: device.height },
    depth: 0,
    children,
  };
}

/**
 * Convert a `native-inspect` bundle to the uniform `Capture`. A payload with no
 * usable windows yields an empty synthetic root so the UI shows the empty state.
 */
export function normalizeCapture(raw: RawCapture): Capture {
  const windows = Array.isArray(raw.inspect?.windows)
    ? raw.inspect.windows
    : [];
  const roots: HierarchyNode[] = [];
  for (const w of windows) {
    if (w && typeof w === "object") {
      roots.push(normalizeNode(w as Record<string, unknown>, 0));
    }
  }

  const hierarchy =
    roots.length === 1 ? roots[0] : syntheticRoot(roots, raw.device);

  return {
    capturedAt: raw.capturedAt,
    device: raw.device,
    screenshot: raw.screenshot,
    nodeCount: num(raw.inspect?.nodeCount) ?? countNodes(hierarchy),
    hierarchy,
  };
}

function countNodes(root: HierarchyNode): number {
  let n = 1;
  for (const child of root.children) {
    n += countNodes(child);
  }

  return n;
}
