import type { Capture, HierarchyNode, RendererMode } from "./types";
import { FlatRenderer } from "./FlatRenderer";

interface InspectionRendererProps {
  capture: Capture;
  mode?: RendererMode;
  /** Subtree to render + hit-test (the focused node); defaults to the full tree. */
  root?: HierarchyNode;
}

/**
 * Renderer abstraction. v1 only ships the `'2d'` implementation; `'3d'`
 * throws so future react-three-fiber code can drop in without changing
 * call sites.
 */
export function InspectionRenderer({
  capture,
  mode = "2d",
  root,
}: InspectionRendererProps) {
  if (mode === "3d") {
    throw new Error("3D renderer not available in v1");
  }

  return <FlatRenderer capture={capture} root={root} />;
}
