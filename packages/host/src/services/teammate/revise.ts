/**
 * "Rewrite with Claude" for a soul: an instruction in, a rewritten soul out.
 * Nothing is saved — the editor shows it and the user decides.
 */

import { tmpdir } from "node:os";
import { runClaudePrint } from "../llm/oneShot";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { MAX_SOUL_CHARS } from "./soul";

const SYSTEM_PROMPT =
  "You rewrite the persona of a named AI teammate in Argus. Reply with the complete revised persona as markdown and nothing else — no preamble, no explanation of what you changed.";

const MAX_INSTRUCTION_CHARS = 2_000;
const TIMEOUT_MS = 90_000;

export function sanitizeSoul(raw: string): string | null {
  const fenced = raw.match(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n?```\s*$/);
  const body = (fenced?.[1] ?? raw).trim();

  return body ? body.slice(0, MAX_SOUL_CHARS) : null;
}

export function buildSoulPrompt(opts: {
  soul: string;
  instruction: string;
  name: string;
}): string {
  return [
    `Rewrite the persona of the teammate **${opts.name}** to follow the instruction below, keeping everything the instruction doesn't touch.`,
    "",
    "A persona is short: who the teammate is, what it cares about, and how it works — a few lines and a handful of bullets. It is not a playbook: what to do on a schedule lives elsewhere.",
    "",
    "## Current persona",
    "",
    opts.soul.trim() || "(empty — write a first one)",
    "",
    "## Instruction",
    "",
    opts.instruction,
  ].join("\n");
}

export async function reviseSoul(opts: {
  soul: string;
  instruction: string;
  name: string;
}): Promise<{ soul: string }> {
  const instruction = opts.instruction.trim().slice(0, MAX_INSTRUCTION_CHARS);
  if (!instruction) {
    throw "Say what you want changed about the soul first.";
  }
  const result = await runClaudePrint({
    prompt: buildSoulPrompt({ ...opts, instruction }),
    cwd: tmpdir(),
    model: "sonnet",
    source: "automation_authoring",
    systemPrompt: SYSTEM_PROMPT,
    timeoutMs: TIMEOUT_MS,
  });
  if (!result) {
    throw "Claude could not be reached to rewrite the soul. Check that `claude` is on your PATH and logged in, then try again.";
  }
  const soul = sanitizeSoul(result);
  if (!soul) {
    throw "Claude returned an empty soul. Try a more specific instruction.";
  }
  telemetryCapture("teammate_soul_changed", { via: "revise" });

  return { soul };
}
