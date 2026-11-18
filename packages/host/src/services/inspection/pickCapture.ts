/**
 * One capture to pick an element from on the live device preview: the
 * injected in-process tree when the iOS app has it, otherwise conductor's
 * `capture-ui` (XCUITest / uiautomator), reshaped into the inspector's
 * `{ device, inspect: { windows }, screenshot }` so both read it the same way.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger } from "@argus/host/logger";
import { captureUi, runConductor } from "./capture";
import { readInprocPort } from "./inproc";

const log = createLogger("inspection:pick");

export interface PickCaptureRequest {
  deviceKey: string;
  platform: "android" | "ios";
}

export async function capturePickable(
  req: PickCaptureRequest,
): Promise<unknown> {
  const { deviceKey, platform } = req;
  if (!deviceKey) {
    throw "No device to capture.";
  }
  if (platform === "ios" && readInprocPort(deviceKey) !== null) {
    try {
      return await captureUi({ deviceKey });
    } catch (err) {
      log.warn("in-process capture failed; using capture-ui", err);
    }
  }

  return fromCaptureUi(await runCaptureUi(deviceKey));
}

async function runCaptureUi(deviceKey: string): Promise<CaptureUiBundle> {
  const output = path.join(
    tmpdir(),
    `argus-pick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  try {
    const res = await runConductor([
      "capture-ui",
      "--device",
      deviceKey,
      "--output",
      output,
    ]);
    if (res.code !== 0) {
      throw res.stderr.trim() || "capture-ui failed";
    }

    return JSON.parse(await fs.readFile(output, "utf8")) as CaptureUiBundle;
  } finally {
    fs.unlink(output).catch(() => {
      // best-effort tmp cleanup
    });
  }
}

// MARK: capture-ui → inspection shape

export interface CaptureUiBundle {
  capturedAt?: string;
  device?: {
    deviceId?: string;
    height?: number;
    platform?: string;
    width?: number;
  };
  hierarchy?: { axElement?: XcuiNode; elements?: AndroidNode[] };
  screenshot?: { data?: string; encoding?: string; kind?: string };
}

interface XcuiNode {
  children?: XcuiNode[];
  elementType?: number;
  enabled?: boolean;
  frame?: { Height?: number; Width?: number; X?: number; Y?: number };
  identifier?: string;
  label?: string;
  nodeId?: string;
  title?: string;
  value?: unknown;
}

interface AndroidNode {
  bounds?: { x1?: number; x2?: number; y1?: number; y2?: number };
  children?: AndroidNode[];
  class?: string;
  contentDescription?: string;
  hintText?: string;
  nodeId?: string;
  resourceId?: string;
  state?: { enabled?: boolean };
  text?: string;
}

interface InspectNode {
  absFrame: Frame;
  accessibilityIdentifier?: string;
  accessibilityLabel?: string;
  children: InspectNode[];
  class: string;
  enabled?: boolean;
  frame: Frame;
  id: string;
  placeholder?: string;
  text?: string;
}

interface Frame {
  h: number;
  w: number;
  x: number;
  y: number;
}

export function fromCaptureUi(bundle: CaptureUiBundle): unknown {
  const ios = bundle.hierarchy?.axElement;
  const windows = ios
    ? (ios.children ?? []).map((n) => xcuiNode(n, "0"))
    : (bundle.hierarchy?.elements ?? []).map((n, i) =>
        androidNode(n, String(i)),
      );
  let nodeCount = 0;
  const count = (n: InspectNode): void => {
    nodeCount++;
    n.children.forEach(count);
  };
  windows.forEach(count);

  return {
    capturedAt: bundle.capturedAt ?? new Date().toISOString(),
    device: bundle.device ?? {},
    inspect: { nodeCount, windows },
    screenshot: bundle.screenshot,
  };
}

function xcuiNode(n: XcuiNode, fallbackId: string): InspectNode {
  const f = n.frame ?? {};
  const frame = { x: f.X ?? 0, y: f.Y ?? 0, w: f.Width ?? 0, h: f.Height ?? 0 };
  const id = n.nodeId ?? fallbackId;

  return {
    id,
    class: XCUI_TYPES[n.elementType ?? 1] ?? "Other",
    frame,
    absFrame: frame,
    accessibilityIdentifier: n.identifier || undefined,
    accessibilityLabel: n.label || undefined,
    text:
      typeof n.value === "string" && n.value ? n.value : n.title || undefined,
    enabled: n.enabled,
    children: (n.children ?? []).map((c, i) => xcuiNode(c, `${id}.${i}`)),
  };
}

function androidNode(n: AndroidNode, fallbackId: string): InspectNode {
  const b = n.bounds ?? {};
  const frame = {
    x: b.x1 ?? 0,
    y: b.y1 ?? 0,
    w: (b.x2 ?? 0) - (b.x1 ?? 0),
    h: (b.y2 ?? 0) - (b.y1 ?? 0),
  };
  const id = n.nodeId ?? fallbackId;

  return {
    id,
    class: n.class || "View",
    frame,
    absFrame: frame,
    accessibilityIdentifier: n.resourceId || undefined,
    accessibilityLabel: n.contentDescription || undefined,
    text: n.text || undefined,
    placeholder: n.hintText || undefined,
    enabled: n.state?.enabled,
    children: (n.children ?? []).map((c, i) => androidNode(c, `${id}.${i}`)),
  };
}

/** `XCUIElement.ElementType` raw values, as XCUITest names them. */
const XCUI_TYPES: Record<number, string> = {
  0: "Any",
  1: "Other",
  2: "Application",
  3: "Group",
  4: "Window",
  5: "Sheet",
  6: "Drawer",
  7: "Alert",
  8: "Dialog",
  9: "Button",
  10: "RadioButton",
  11: "RadioGroup",
  12: "CheckBox",
  13: "DisclosureTriangle",
  14: "PopUpButton",
  15: "ComboBox",
  16: "MenuButton",
  17: "ToolbarButton",
  18: "Popover",
  19: "Keyboard",
  20: "Key",
  21: "NavigationBar",
  22: "TabBar",
  23: "TabGroup",
  24: "Toolbar",
  25: "StatusBar",
  26: "Table",
  27: "TableRow",
  28: "TableColumn",
  29: "Outline",
  30: "OutlineRow",
  31: "Browser",
  32: "CollectionView",
  33: "Slider",
  34: "PageIndicator",
  35: "ProgressIndicator",
  36: "ActivityIndicator",
  37: "SegmentedControl",
  38: "Picker",
  39: "PickerWheel",
  40: "Switch",
  41: "Toggle",
  42: "Link",
  43: "Image",
  44: "Icon",
  45: "SearchField",
  46: "ScrollView",
  47: "ScrollBar",
  48: "StaticText",
  49: "TextField",
  50: "SecureTextField",
  51: "DatePicker",
  52: "TextView",
  53: "Menu",
  54: "MenuItem",
  55: "MenuBar",
  56: "MenuBarItem",
  57: "Map",
  58: "WebView",
  75: "Cell",
  79: "Stepper",
  80: "Tab",
};
