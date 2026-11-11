import type { AcpPreset } from "../preset";

export const GROK_PRESET: AcpPreset = {
  id: "grok",
  displayName: "Grok Build",
  bins: ["grok"],
  // `default` makes it ask, so Argus's mode decides; no self-update mid-session.
  args: ["--no-auto-update", "--permission-mode", "default", "agent", "stdio"],
  installHint: "Install it with `npm install -g @xai-official/grok`.",
  loginHint: "Run `grok` in a terminal once to sign in, or set `XAI_API_KEY`.",
  installCommand: "npm install -g @xai-official/grok",
  loginCommand: "grok",
  authMethodId: () =>
    process.env.XAI_API_KEY ? "xai.api_key" : "cached_token",
  // Grok saves most "always allow" grants project-wide.
  noAlwaysAllow: true,
  cancelMeta: { cancelTrigger: "ctrl_c" },
};
