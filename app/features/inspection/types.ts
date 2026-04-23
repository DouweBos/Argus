/**
 * Data contract for `conductor capture-ui --json` and the inspection panel.
 *
 * Mirrors the JSON shape emitted by the conductor CLI. Three extension seams:
 *   - `capabilities` flags so v2 can opt into per-view pixels / depth data
 *     without breaking v1 consumers.
 *   - `HierarchyNode.pixelSource` so individual nodes can carry their own
 *     rendered pixels later on.
 *   - `RendererMode` so the renderer abstraction can branch into a `'3d'`
 *     implementation without touching call sites.
 */

export interface Frame {
  h: number;
  w: number;
  x: number;
  y: number;
}

export type DevicePlatform = "android" | "ios" | "tvos" | "web";

/**
 * Raw envelope emitted by `conductor capture-ui --json`. The hierarchy is
 * platform-specific and heterogeneous — iOS wraps the tree under `axElement`,
 * Android/Web return a flat `elements` array alongside a raw dump. The
 * `normalizeCapture` helper collapses this variance into the uniform
 * `Capture` shape consumed by the renderer.
 */
export interface RawCapture {
  a11ySnapshot: A11yEntry[];
  capabilities: Capabilities;
  capturedAt: string;
  device: CaptureDevice;
  hierarchy: Record<string, unknown>;
  screenshot: CaptureScreenshot;
  version: 1;
}

export interface CaptureDevice {
  deviceId: string;
  height: number;
  platform: DevicePlatform;
  width: number;
}

export interface CaptureScreenshot {
  /** Base64-encoded image data. */
  data: string;
  encoding: "png";
  /** v1 always returns a single composite screenshot of the full screen. */
  kind: "composite";
}

export interface Capabilities {
  /** Future: per-frame depth buffer for 3D orbit. */
  depthData: boolean;
  /** Future: individual node pixel capture via an injected debug SDK. */
  perViewPixels: boolean;
}

export interface NodeState {
  enabled: boolean;
  focused: boolean;
  selected: boolean;
}

/**
 * Future extension seam: a node may carry its own rendered pixels (from an
 * injected debug SDK). v1 always omits this; the resolver ignores it unless
 * `capabilities.perViewPixels` is also true.
 */
export interface NodePixelSource {
  kind: "image";
  url: string;
}

export interface HierarchyNode {
  accessibilityOrder: number | null;
  children: HierarchyNode[];
  frame: Frame;
  hint?: string;
  /** Stable path-based id like `"0.2.1.3"`. */
  id: string;
  /** Platform-native identifier (accessibility id / resource id / test id). */
  identifier?: string;
  isAccessibilityElement: boolean;
  label?: string;
  pixelSource?: NodePixelSource;
  role?: string;
  state: NodeState;
  traits?: string[];
  /** Platform-native class/type (e.g. `UIButton`, `android.widget.TextView`). */
  type: string;
  value?: string;
}

export interface A11yEntry {
  announcement?: string;
  frame: Frame;
  hint?: string;
  label?: string;
  nodeId: string;
  order: number;
  role?: string;
  state: NodeState;
  traits?: string[];
  value?: string;
}

export interface Capture {
  a11ySnapshot: A11yEntry[];
  capabilities: Capabilities;
  capturedAt: string;
  device: CaptureDevice;
  hierarchy: HierarchyNode;
  screenshot: CaptureScreenshot;
  version: 1;
}

/**
 * Output of `resolveNodeVisual`. The flat renderer currently uses `crop` and
 * `outline` only; `image` is reserved for the per-view-pixels future.
 */
export type NodeVisual =
  | { bounds: Frame; kind: "crop" }
  | { kind: "image"; url: string }
  | { kind: "outline" };

export type RendererMode = "2d" | "3d";
