import type { AcpPreset } from "../preset";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const flagByBin = new Map<string, Promise<string>>();

/** Gemini CLI renamed `--experimental-acp` to `--acp`; ask the installed one. */
async function acpFlag(binPath: string): Promise<string> {
  let flag = flagByBin.get(binPath);
  if (!flag) {
    flag = execFileAsync(binPath, ["--help"], { timeout: 15_000 })
      .then(({ stdout }) =>
        /--acp\b/.test(stdout) ? "--acp" : "--experimental-acp",
      )
      .catch(() => "--experimental-acp");
    flagByBin.set(binPath, flag);
  }

  return flag;
}

export const GEMINI_PRESET: AcpPreset = {
  id: "gemini",
  displayName: "Gemini CLI",
  bins: ["gemini"],
  args: async (binPath) => [await acpFlag(binPath)],
  installHint: "Install it with `npm install -g @google/gemini-cli`.",
  loginHint: "Run `gemini` in a terminal once to sign in.",
  installCommand: "npm install -g @google/gemini-cli",
  loginCommand: "gemini",
  authMethodId: () =>
    process.env.GEMINI_API_KEY ? "gemini-api-key" : "oauth-personal",
  // Argus answers Gemini's approval requests; trusted skips them outright.
  modeIds: {
    ask: "default",
    review: "default",
    auto: "default",
    trusted: "yolo",
  },
};
