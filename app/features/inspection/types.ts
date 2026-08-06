/**
 * Data contract for `conductor native-inspect --json` and the inspection panel.
 *
 * `native-inspect` reads the running iOS/tvOS app *in-process* (a dylib injected
 * via `launch-app --inject`) and returns one already-unified Apple view tree
 * with resolved colors, fonts, text, and layer visuals — so there's no
 * per-platform heterogeneity to collapse. `absFrame`, `depth`, `z`, and per-node
 * `native-snapshot` textures are the inputs a future 3D exploded-layer viewer
 * consumes; `NodeVisual.image` is the seam it slots into.
 */

export interface Frame {
  h: number;
  w: number;
  x: number;
  y: number;
}

/** Inspection is Apple-only; Android/Web are not offered. */
export type DevicePlatform = "ios" | "tvos";

/** UIFont detail resolved from a control or an attributed-text run. */
export interface FontInfo {
  bold?: boolean;
  family: string;
  italic?: boolean;
  name: string;
  size: number;
  weight?: number;
}

/** React Native tag mapping so a node reads as its JSX component. */
export interface ReactNativeInfo {
  nativeID?: string;
  reactTag?: string;
  testID?: string;
}

/** UIImageView content metadata (native size + asset name). */
export interface NodeImageInfo {
  h: number;
  name?: string;
  scale: number;
  w: number;
}

/**
 * One UIView/CALayer node from `native-inspect`. Everything past
 * id/class/frame/depth/children is optional — the bridge only emits a key when
 * it carries signal (a non-default color, non-empty text, non-identity
 * transform), so absence means "default", not "unknown".
 */
export interface HierarchyNode {
  /** Window-absolute rect — box position on the overlay + the 3D plane's rect. */
  absFrame?: Frame;
  accessibilityIdentifier?: string;
  accessibilityLabel?: string;
  alpha?: number;
  anchorPoint?: { x: number; y: number };
  /** `#RRGGBBAA`. */
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  children: HierarchyNode[];
  /** Native class, e.g. `UIButton`, `RCTParagraphComponentView`. */
  class: string;
  cornerRadius?: number;
  depth: number;
  enabled?: boolean;
  font?: FontInfo;
  /** Local frame, relative to the superview. */
  frame: Frame;
  gradientColors?: string[];
  hasMask?: boolean;
  hidden?: boolean;
  /** Stable within a launch; pointer-based, so it resets on relaunch. */
  id: string;
  image?: NodeImageInfo;
  /** `CACornerMask` raw value when only some corners are rounded. */
  maskedCorners?: number;
  masksToBounds?: boolean;
  placeholder?: string;
  rn?: ReactNativeInfo;
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  text?: string;
  textColor?: string;
  tintColor?: string;
  /** UIButton title (distinct from `text` on labels/fields). */
  title?: string;
  titleColor?: string;
  /** 16 row-major CATransform3D values, present only when non-identity. */
  transform3D?: number[];
  /** Subtree pruned at the bridge's depth/node cap; count of dropped subviews. */
  truncated?: number;
  /** Layer `zPosition` for sibling ordering (present only when non-zero). */
  z?: number;
}

export interface CaptureDevice {
  deviceId: string;
  height: number;
  platform: DevicePlatform;
  width: number;
}

export interface CaptureScreenshot {
  /** Base64-encoded PNG. */
  data: string;
  encoding: "png";
  /** Full-screen composite from `native-screenshot`. */
  kind: "composite";
}

/** Envelope emitted by `native-inspect`: `{ status, nodeCount, windows }`. */
export interface RawInspect {
  nodeCount?: number;
  status?: string;
  windows?: unknown[];
}

/**
 * Bundle the Argus backend assembles per inspect: the `native-inspect` tree plus
 * an optional `native-screenshot` background. `normalizeCapture` turns it into
 * the `Capture` the renderer consumes.
 */
export interface RawCapture {
  capturedAt: string;
  device: CaptureDevice;
  inspect: RawInspect;
  screenshot?: CaptureScreenshot;
}

export interface Capture {
  capturedAt: string;
  device: CaptureDevice;
  hierarchy: HierarchyNode;
  nodeCount: number;
  /** Optional — the overlay renders bare boxes if the screenshot is missing. */
  screenshot?: CaptureScreenshot;
}

/**
 * How a node draws in the 2D overlay. `fill` carries the node's real
 * `backgroundColor`; `image` is reserved for the per-layer `native-snapshot`
 * texture a 3D viewer will use.
 */
export type NodeVisual =
  | { color: string; kind: "fill" }
  | { kind: "image"; url: string }
  | { kind: "outline" };

export type RendererMode = "2d" | "3d";
