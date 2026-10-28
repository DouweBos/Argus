/** How the log names a device kind or host platform, for people. */
export function memberKindLabel(kind: string): string {
  switch (kind) {
    case "ios":
      return "iPhone";
    case "mac":
      return "Mac app";
    case "electron":
      return "Desktop app";
    case "web":
      return "Browser";
    case "linux":
      return "Linux computer";
    default:
      return "Mac";
  }
}
