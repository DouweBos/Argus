import type { Route } from "./route";
import type { LspLanguage } from "@argus/remote-protocol";
import path from "node:path";
import { canonicalSessionRoot } from "../code/paths";
import { swiftRoute } from "./swift/context";

/** The server a document belongs to. Files outside the session share its root. */
export function routeFor(
  sessionId: string,
  language: LspLanguage,
  absolute: string,
): Route {
  const root = canonicalSessionRoot(sessionId);
  const inside = absolute.startsWith(root + path.sep);
  if (language === "swift" && inside) {
    return swiftRoute(root, absolute);
  }

  return { root };
}
