/** The brief a blueprint's agent starts with. */

import type { Blueprint } from "@argus/remote-protocol";

export interface BlueprintPromptContext {
  name: string;
  description: string;
  repoRoot: string;
  /** Null when the project has no GitHub repository. */
  repoUrl: string | null;
}

/** Fill `{{name}}`, `{{description}}`, `{{repo}}` and `{{path}}`; leave anything else alone. */
export function renderBlueprintInstructions(
  instructions: string,
  ctx: BlueprintPromptContext,
): string {
  const values: Record<string, string> = {
    name: ctx.name,
    description: ctx.description,
    repo: ctx.repoUrl ?? "(no GitHub repository)",
    path: ctx.repoRoot,
  };

  return instructions.replace(
    /\{\{\s*(name|description|repo|path)\s*\}\}/g,
    (_, key: string) => values[key],
  );
}

export function buildBlueprintPrompt(
  blueprint: Blueprint,
  ctx: BlueprintPromptContext,
): string {
  const lines = [
    `# New project: ${ctx.name}`,
    "",
    ctx.description.trim() || "(no description given)",
    "",
    `This project was just created at \`${ctx.repoRoot}\` from the "${blueprint.name}" blueprint.`,
  ];
  if (ctx.repoUrl) {
    lines.push(`Its GitHub repository is ${ctx.repoUrl}.`);
  }

  const instructions = renderBlueprintInstructions(
    blueprint.instructions,
    ctx,
  ).trim();
  if (instructions) {
    lines.push("", "## Instructions", "", instructions);
  }

  if (blueprint.references.length > 0) {
    lines.push(
      "",
      "## Reference projects",
      "",
      "Study these and mirror their structure, build, signing and release setup. Copy their files rather than guessing.",
      "",
      ...blueprint.references.map((ref) =>
        ref.note.trim()
          ? `- \`${ref.path}\` — ${ref.note.trim()}`
          : `- \`${ref.path}\``,
      ),
    );
  }

  lines.push(
    "",
    "---",
    "",
    ctx.repoUrl
      ? "Commit as you go, with small focused commits, and push to origin."
      : "Commit as you go, with small focused commits.",
  );

  return lines.join("\n");
}
