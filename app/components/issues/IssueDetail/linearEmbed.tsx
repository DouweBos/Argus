import type { ReactNode } from "react";
import { LinearImage, LinearVideo } from "./LinearMedia";

const VIDEO_NAME = /\.(mov|mp4|m4v|webm)$/i;

function isLinearUpload(url: string): boolean {
  try {
    return new URL(url).hostname === "uploads.linear.app";
  } catch {
    return false;
  }
}

/**
 * Markdown embed hook for issue text: Linear-hosted recordings become players
 * and Linear-hosted images load through the host's signed-in copy.
 */
export function renderLinearEmbed(
  kind: "image" | "link",
  url: string,
  label: string,
): ReactNode | null {
  if (!isLinearUpload(url)) {
    return null;
  }
  if (kind === "image") {
    return <LinearImage label={label} url={url} />;
  }
  if (VIDEO_NAME.test(label) || VIDEO_NAME.test(new URL(url).pathname)) {
    return <LinearVideo label={label || "Video"} url={url} />;
  }

  return null;
}
