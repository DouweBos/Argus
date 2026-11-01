/** Side-panel tab of the design viewer; `layers` owns the bare URL. */
export type DesignTab = "comments" | "layers" | "pages";
const DESIGN_TABS: DesignTab[] = ["comments", "layers", "pages"];

/**
 * `/design?url=<figma url>[&session=<id>][&tab=comments|pages][&compare=1]`
 * — the design viewer.
 */
export interface DesignRouteFields {
  /** Showing the frame against the session's device instead of on its own. */
  designCompare: boolean;
  /** The session the viewer was opened from, to compare against its device. */
  designSessionId: string | null;
  designTab: DesignTab;
  /** The Figma frame open in the design viewer. Only set when view === "design". */
  designUrl: string | null;
}

export function designRouteFields(
  pathname: string,
  params: URLSearchParams,
): DesignRouteFields {
  const first = pathname.split("/").filter(Boolean)[0];
  if (first !== "design") {
    return {
      designCompare: false,
      designSessionId: null,
      designTab: "layers",
      designUrl: null,
    };
  }
  const sessionId = params.get("session") || null;

  return {
    designCompare: !!sessionId && params.get("compare") === "1",
    designSessionId: sessionId,
    designTab: DESIGN_TABS.find((t) => t === params.get("tab")) ?? "layers",
    designUrl: params.get("url") || null,
  };
}

export function designPathname(fields: Partial<DesignRouteFields>): string {
  const query = new URLSearchParams();
  if (fields.designUrl) {
    query.set("url", fields.designUrl);
  }
  if (fields.designSessionId) {
    query.set("session", fields.designSessionId);
    if (fields.designCompare) {
      query.set("compare", "1");
    }
  }
  if (fields.designTab && fields.designTab !== "layers") {
    query.set("tab", fields.designTab);
  }
  const search = query.toString();

  return search ? `/design?${search}` : "/design";
}
