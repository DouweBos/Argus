import type { ReactNode } from "react";
import { linearMediaFor } from "@argus/client-core";
import { LinearMedia } from "./LinearMedia";

/**
 * Markdown embed hook for issue text: Linear-hosted recordings become players
 * and Linear-hosted images load through the host's signed-in copy.
 */
export function renderLinearEmbed(
  kind: "image" | "link",
  url: string,
  label: string,
): ReactNode | null {
  const media = linearMediaFor(kind, url, label);

  return media ? <LinearMedia media={media} /> : null;
}
