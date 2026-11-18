/**
 * Rewrite a blueprint's instructions to what the user says is wrong. Claude
 * may re-read the reference projects to get the facts right. Nothing is saved:
 * the new text goes back to the editor.
 */

import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { runClaudePrint } from "../llm/oneShot";
import { capture as telemetryCapture } from "../telemetry/telemetry";

const REVISE_TIMEOUT_MS = 600_000;
const MAX_NOTE_CHARS = 2000;
const MAX_INSTRUCTIONS_CHARS = 30_000;

const SYSTEM_PROMPT =
  "You revise blueprints for Argus, an agentic IDE: recipes an agent follows to start a new project modelled on existing ones. You only read files; you never write, run or post anything. You reply with the complete revised instructions as markdown and nothing else — no preamble, no explanation of what you changed.";

export interface ReviseBlueprintOptions {
  instructions: string;
  /** What the user wants changed, in their own words. */
  note: string;
  name?: string;
  /** Reference projects Claude may read to check the facts. */
  references: string[];
}

/** Strip the fence a model wraps markdown in and cap the length. Pure. */
export function sanitizeRevisedInstructions(raw: string): string | null {
  const fenced = raw.match(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n?```\s*$/);
  const body = (fenced?.[1] ?? raw).trim();

  return body ? body.slice(0, MAX_INSTRUCTIONS_CHARS) : null;
}

export function buildBlueprintRevisionPrompt(
  opts: ReviseBlueprintOptions,
): string {
  return [
    "Revise the blueprint instructions below to do what the note asks.",
    "",
    "The instructions are handed to an agent that starts in a brand-new, empty",
    "repository and sets the new app up the same way as the reference projects.",
    "",
    opts.name ? `## The blueprint\n${opts.name}\n` : "",
    opts.references.length > 0
      ? `## Reference projects\nRead them with Read, Grep and Glob when the note is about what they contain.\n${opts.references.map((p) => `- ${p}`).join("\n")}\n`
      : "",
    "## The note",
    opts.note,
    "",
    "## The current instructions",
    "",
    opts.instructions,
    "",
    "## Reply with",
    "The complete revised instructions, as markdown, ready to paste back in. Keep",
    "everything the note did not ask you to change — this replaces the text, so",
    "anything you leave out is lost. Keep {{name}} and {{description}} as they are.",
    "Do not wrap it in a code fence.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function reviseBlueprintInstructions(
  opts: ReviseBlueprintOptions,
): Promise<{ instructions: string }> {
  const fail = (message: string): never => {
    telemetryCapture("blueprint_revised", { success: false });
    throw message;
  };
  const note = opts.note.trim().slice(0, MAX_NOTE_CHARS);
  if (!note) {
    fail("Say what you want changed about the instructions first.");
  }
  const instructions = opts.instructions.trim();
  if (!instructions) {
    fail("There are no instructions to revise yet.");
  }
  const references = [
    ...new Set(opts.references.map((p) => path.resolve(p))),
  ].filter((p) => fs.existsSync(p));

  const result = await runClaudePrint({
    prompt: buildBlueprintRevisionPrompt({
      ...opts,
      note,
      instructions,
      references,
    }),
    cwd: references[0] ?? tmpdir(),
    addDirs: references.slice(1),
    model: "sonnet",
    source: "blueprint_revise",
    systemPrompt: SYSTEM_PROMPT,
    tools: references.length > 0 ? ["Read", "Grep", "Glob"] : [],
    timeoutMs: REVISE_TIMEOUT_MS,
  });
  if (!result) {
    fail(
      "Claude could not be reached to revise the blueprint. Check that `claude` is on your PATH and logged in, then try again.",
    );
  }

  const revised = sanitizeRevisedInstructions(result ?? "");
  if (!revised) {
    warn("blueprint revise: unusable reply");

    return fail("Claude did not return usable instructions. Try again.");
  }
  telemetryCapture("blueprint_revised", { success: true });

  return { instructions: revised };
}
