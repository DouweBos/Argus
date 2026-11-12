import type { RunnerAuthProbe } from "../../types";
import type { AcpPreset } from "../preset";

export const CURSOR_PRESET: AcpPreset = {
  id: "cursor",
  displayName: "Cursor",
  // Older installs only have `cursor-agent`; newer ones ship `agent` too.
  bins: ["cursor-agent", "agent"],
  args: ["acp"],
  installHint:
    "Install the Cursor CLI with `curl https://cursor.com/install -fsS | bash`.",
  loginHint: "Run `cursor-agent login` in a terminal to sign in.",
  installCommand: "curl https://cursor.com/install -fsS | bash",
  loginCommand: "cursor-agent login",
  logoutCommand: "cursor-agent logout",
  // "Not logged in", "Partially authenticated", or "✓ Logged in as <email>".
  authStatus: { args: ["status"], parse: parseCursorStatus },
  // Uses the CLI's stored login; it asks for this before every new session.
  authMethodId: "cursor_login",
};

export function parseCursorStatus(output: string): RunnerAuthProbe {
  if (/not logged in|partially authenticated/i.test(output)) {
    return { signedIn: false, account: null };
  }
  const email = /logged in as\s+(\S+@\S+)/i.exec(output)?.[1] ?? null;
  if (email || /logged in/i.test(output)) {
    return { signedIn: true, account: email };
  }

  return { signedIn: null, account: null };
}
