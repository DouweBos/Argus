import type { AcpPreset } from "../preset";

export const KIRO_PRESET: AcpPreset = {
  id: "kiro",
  displayName: "Kiro",
  bins: ["kiro-cli"],
  args: ["acp"],
  installHint:
    "Install Kiro CLI with `curl -fsSL https://cli.kiro.dev/install | bash`.",
  loginHint: "Run `kiro-cli login` in a terminal to sign in.",
  // Kiro saves "always allow" as a workspace-wide rule.
  noAlwaysAllow: true,
  // Autopilot runs without asking; off, Kiro asks and Argus decides.
  configFor: (mode) => ({ autopilot: mode === "trusted" ? "on" : "off" }),
};
