import type { RunnerAuthProbe } from "../../types";
import type { AcpPreset } from "../preset";

export const KIRO_PRESET: AcpPreset = {
  id: "kiro",
  displayName: "Kiro",
  bins: ["kiro-cli"],
  args: ["acp"],
  installHint:
    "Install Kiro CLI with `curl -fsSL https://cli.kiro.dev/install | bash`.",
  loginHint: "Run `kiro-cli login` in a terminal to sign in.",
  installCommand: "curl -fsSL https://cli.kiro.dev/install | bash",
  loginCommand: "kiro-cli login",
  logoutCommand: "kiro-cli logout",
  // "Not logged in" (exit 1), or "Logged in with Builder ID" / "… IAM Identity Center (…)".
  authStatus: { args: ["whoami"], parse: parseKiroWhoami },
  // Kiro saves "always allow" as a workspace-wide rule.
  noAlwaysAllow: true,
  // Autopilot runs without asking; off, Kiro asks and Argus decides.
  configFor: (mode) => ({ autopilot: mode === "trusted" ? "on" : "off" }),
};

export function parseKiroWhoami(output: string): RunnerAuthProbe {
  if (/not logged in/i.test(output)) {
    return { signedIn: false, account: null };
  }
  const via = /logged in with\s+(Builder ID|IAM Identity Center)/i.exec(output);
  if (via) {
    return { signedIn: true, account: via[1] ?? null };
  }

  return { signedIn: null, account: null };
}
