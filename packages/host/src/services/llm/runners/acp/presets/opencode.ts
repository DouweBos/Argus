import type { AcpPreset } from "../preset";

export const OPENCODE_PRESET: AcpPreset = {
  id: "opencode",
  displayName: "OpenCode",
  bins: ["opencode"],
  args: ["acp"],
  installHint: "Install it with `npm install -g opencode-ai`.",
  loginHint: "Run `opencode auth login` in a terminal to add a provider.",
  installCommand: "npm install -g opencode-ai",
  loginCommand: "opencode auth login",
  // OpenCode keeps "always allow" grants project-wide.
  noAlwaysAllow: true,
};
