import type { AccountMember } from "@argus/remote-protocol/account";

/** How the log names a member's kind, for people. */
export function memberKindLabel(member: AccountMember): string {
  if (member.role === "host") {
    return member.platform === "linux" ? "Linux computer" : "Mac computer";
  }
  switch (member.kind) {
    case "ios":
      return "iPhone";
    case "android":
      return "Android phone";
    case "mac":
      return "Mac app";
    case "electron":
      return "Desktop app";
    case "web":
      return "Browser";
    // A kind added after this build: still a trusted device, just unnamed.
    default:
      return "Device";
  }
}

export function addedLabel(member: AccountMember): string {
  return `added ${new Date(member.created_at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;
}
