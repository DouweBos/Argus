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
  // Uses the CLI's stored login; it asks for this before every new session.
  authMethodId: "cursor_login",
};
