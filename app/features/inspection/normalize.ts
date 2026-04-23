/**
 * Collapses the platform-specific `conductor capture-ui` shape into the
 * uniform `Capture` used by the renderer.
 *
 * Conductor emits three different hierarchy envelopes:
 *   - iOS / tvOS: `{ axElement, depth }`             (single XCUIElement tree)
 *   - Android:    `{ xml, elements }`                (uiautomator flat + tree)
 *   - Web:        `{ ...playwrightVh, elements }`    (AX tree array)
 *
 * Per-node shapes also vary (frame casing, class vs type vs role, state
 * grouping). The renderer consumes a single `HierarchyNode` tree, so this
 * module absorbs the variance in one place. If conductor later unifies its
 * output, this file goes away — no call sites change.
 */

import type {
  Capture,
  CaptureDevice,
  Frame,
  HierarchyNode,
  NodeState,
  RawCapture,
} from "./types";

// XCUIElementType raw values → human-readable type string.
// Subset — conductor's own `IOS_TYPE_TO_TRAIT` covers the user-facing ones;
// for anything else we render `UIElement_<n>` so the tree stays readable.
const IOS_ELEMENT_TYPE_NAMES: Record<number, string> = {
  0: "Any",
  3: "Application",
  4: "Window",
  5: "Sheet",
  6: "Drawer",
  7: "Alert",
  8: "UIImageView",
  9: "UIButton",
  10: "RadioButton",
  14: "CheckBox",
  15: "DisclosureTriangle",
  23: "UISlider",
  24: "Page",
  25: "Tab",
  40: "UISwitch",
  44: "Toggle",
  47: "NavigationBar",
  48: "UILabel",
  49: "UITextField",
  50: "UISecureTextField",
  51: "DatePicker",
  52: "UITextView",
  53: "Menu",
  54: "Link",
  55: "Outline",
  60: "WebView",
  70: "UITable",
  73: "UIPicker",
  74: "UIPickerView",
  75: "UITableCell",
  78: "UIScrollView",
  82: "UIView",
  90: "UIStepper",
  93: "UISearchField",
};

function iosTypeName(code: unknown): string {
  if (typeof code !== "number") {
    return "UIElement";
  }

  return IOS_ELEMENT_TYPE_NAMES[code] ?? `UIElement_${code}`;
}

function normalizeFrame(source: unknown): Frame {
  const raw = (source ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): number => {
    for (const key of keys) {
      const v = raw[key];
      if (typeof v === "number") {
        return v;
      }
    }

    return 0;
  };
  // iOS bounds ({X,Y,Width,Height}) · Web Playwright ({x,y,width,height}) ·
  // Android uiautomator ({x1,y1,x2,y2}).
  if ("x1" in raw) {
    const x1 = pick("x1");
    const y1 = pick("y1");
    const x2 = pick("x2");
    const y2 = pick("y2");

    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  return {
    x: pick("x", "X"),
    y: pick("y", "Y"),
    w: pick("w", "width", "Width"),
    h: pick("h", "height", "Height"),
  };
}

function normalizeState(node: Record<string, unknown>): NodeState {
  const state = node.state as Record<string, unknown> | undefined;
  if (state && typeof state === "object") {
    return {
      enabled: Boolean(state.enabled),
      selected: Boolean(state.selected),
      focused: Boolean(state.focused),
    };
  }

  // iOS puts these at the node root.
  return {
    enabled: Boolean(node.enabled),
    selected: Boolean(node.selected),
    focused: Boolean(node.hasFocus ?? node.focused),
  };
}

function asString(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length === 0) {
    return undefined;
  }

  return v;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) {
    return undefined;
  }
  const strings = v.filter((x): x is string => typeof x === "string");

  return strings.length > 0 ? strings : undefined;
}

interface NormalizeOpts {
  defaultFallbackType: string;
  parentPath: string | null;
}

function normalizeNode(
  raw: Record<string, unknown>,
  platform: CaptureDevice["platform"],
  opts: NormalizeOpts,
  fallbackIndex: number,
): HierarchyNode {
  // Prefer conductor's nodeId; synthesize path if absent.
  const rawId = asString(raw.nodeId);
  const id =
    rawId ??
    (opts.parentPath === null
      ? String(fallbackIndex)
      : `${opts.parentPath}.${fallbackIndex}`);

  let type: string;
  if (platform === "ios" || platform === "tvos") {
    type = iosTypeName(raw.elementType);
  } else if (platform === "android") {
    type = asString(raw.class) ?? opts.defaultFallbackType;
  } else {
    type = asString(raw.role) ?? opts.defaultFallbackType;
  }

  const label =
    asString(raw.label) ??
    asString(raw.accessibilityLabel) ??
    asString(raw.text) ??
    asString(raw.contentDescription) ??
    asString(raw.name) ??
    asString(raw.title);

  const identifier =
    asString(raw.identifier) ??
    asString(raw.accessibilityIdentifier) ??
    asString(raw.resourceId);

  const hint =
    asString(raw.hint) ??
    asString(raw.accessibilityHint) ??
    asString(raw.hintText);

  const value =
    asString(raw.value) ??
    asString(raw.accessibilityValue) ??
    asString(raw.placeholderValue);

  const role = asString(raw.role) ?? asString(raw.roleDescription);

  const children: HierarchyNode[] = [];
  const rawChildren = raw.children;
  if (Array.isArray(rawChildren)) {
    rawChildren.forEach((c, i) => {
      if (c && typeof c === "object") {
        children.push(
          normalizeNode(
            c as Record<string, unknown>,
            platform,
            { defaultFallbackType: opts.defaultFallbackType, parentPath: id },
            i,
          ),
        );
      }
    });
  }

  return {
    id,
    type,
    frame: normalizeFrame(raw.frame ?? raw.bounds),
    children,
    label,
    identifier,
    hint,
    value,
    role,
    traits: asStringArray(raw.traits),
    state: normalizeState(raw),
    accessibilityOrder:
      typeof raw.accessibilityOrder === "number"
        ? raw.accessibilityOrder
        : null,
    isAccessibilityElement: Boolean(raw.isAccessibilityElement),
  };
}

function syntheticRoot(
  elements: HierarchyNode[],
  device: CaptureDevice,
  typeLabel: string,
): HierarchyNode {
  return {
    id: "root",
    type: typeLabel,
    frame: { x: 0, y: 0, w: device.width, h: device.height },
    children: elements,
    isAccessibilityElement: false,
    accessibilityOrder: null,
    state: { enabled: true, selected: false, focused: false },
  };
}

/**
 * Convert `conductor capture-ui --json` output to the uniform `Capture` shape
 * consumed by the renderer. Unknown input is tolerated — anything that fails
 * to parse returns an empty synthetic root so the UI shows the empty state
 * instead of crashing.
 */
export function normalizeCapture(raw: RawCapture): Capture {
  const device = raw.device;
  const platform = device.platform;
  const envelope = raw.hierarchy ?? {};

  let root: HierarchyNode;
  if (platform === "ios" || platform === "tvos") {
    const axElement = envelope.axElement as Record<string, unknown> | undefined;
    if (axElement && typeof axElement === "object") {
      root = normalizeNode(
        axElement,
        platform,
        { defaultFallbackType: "UIView", parentPath: null },
        0,
      );
    } else {
      root = syntheticRoot([], device, "UIWindow");
    }
  } else {
    const fallbackType =
      platform === "android" ? "android.view.ViewGroup" : "div";
    const elements = (envelope.elements ?? []) as unknown;
    const normalized: HierarchyNode[] = [];
    if (Array.isArray(elements)) {
      elements.forEach((el, i) => {
        if (el && typeof el === "object") {
          normalized.push(
            normalizeNode(
              el as Record<string, unknown>,
              platform,
              { defaultFallbackType: fallbackType, parentPath: null },
              i,
            ),
          );
        }
      });
    }
    root =
      normalized.length === 1
        ? normalized[0]
        : syntheticRoot(normalized, device, fallbackType);
  }

  return {
    version: raw.version,
    capturedAt: raw.capturedAt,
    device,
    screenshot: raw.screenshot,
    capabilities: raw.capabilities,
    a11ySnapshot: raw.a11ySnapshot,
    hierarchy: root,
  };
}
