import type { AcpPreset } from "../preset";

export const FX_PRESET: AcpPreset = {
  id: "fx",
  displayName: "fx",
  bins: ["fx"],
  args: ["acp"],
  installHint: "Install it with `curl -fsSL https://fx.sh/setup.sh | bash`.",
  loginHint: "Run `fx` in a terminal once to sign in.",
  // `ask` makes it ask, so Argus's mode decides; trusted lets it run (`code` before 0.0.14).
  modeIds: {
    ask: "ask",
    review: "ask",
    auto: "ask",
    trusted: ["auto", "code"],
  },
  // fx reports `ask` after start but enforces the user's saved default.
  setModeOnStart: true,
};
