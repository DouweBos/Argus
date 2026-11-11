import type { AcpPreset } from "../preset";

export const ANTIGRAVITY_PRESET: AcpPreset = {
  id: "antigravity",
  displayName: "Antigravity",
  bins: ["agy"],
  args: ["acp"],
  installHint:
    "Install the Antigravity CLI (`agy`, 1.5 or newer) from antigravity.google.",
  loginHint: "Run `agy acp --login` in a terminal to sign in.",
  installUrl: "https://antigravity.google",
  loginCommand: "agy acp --login",
  authMethodId: "oauth-personal",
  // It offers `session/load` but only `session/resume` keeps the conversation.
  resumeVia: "resume",
  // Its prompt append must ride every new or resumed session; `run_workflow`
  // writes skill files into the worktree.
  sessionMeta: (systemPrompt) => ({
    antigravity: {
      ...(systemPrompt ? { systemPrompt: { append: systemPrompt } } : {}),
      disabledTools: ["run_workflow"],
    },
  }),
};
