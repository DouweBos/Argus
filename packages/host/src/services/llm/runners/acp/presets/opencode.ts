import type { RunnerAuthProbe } from "../../types";
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
  // Asks which provider to sign out of.
  logoutCommand: "opencode auth logout",
  // "<n> credentials", one per provider; keys in the environment count too.
  authStatus: { args: ["auth", "list"], parse: parseOpencodeAuthList },
  // OpenCode keeps "always allow" grants project-wide.
  noAlwaysAllow: true,
};

export function parseOpencodeAuthList(output: string): RunnerAuthProbe {
  const count = /(\d+)\s+credentials?\b/i.exec(output);
  if (count) {
    const n = Number(count[1]);
    if (n > 0) {
      return {
        signedIn: true,
        account: n === 1 ? "1 provider" : `${n} providers`,
      };
    }

    return {
      signedIn: /\benvironment\b/i.test(output) ? null : false,
      account: null,
    };
  }
  if (/no authenticated integrations/i.test(output)) {
    return { signedIn: false, account: null };
  }

  return { signedIn: null, account: null };
}
