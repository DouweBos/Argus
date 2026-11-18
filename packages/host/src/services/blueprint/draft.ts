/**
 * A blueprint drafted from existing projects. Claude reads them, read-only, and
 * writes instructions that name the exact files a new project should mirror.
 * Nothing is saved: the draft opens in the editor for review.
 */

import type {
  BlueprintDraft,
  BlueprintScaffold,
  BlueprintVisibility,
} from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { extractJsonObject } from "../automation/authoring";
import { runClaudePrint } from "../llm/oneShot";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { runGh, runGit } from "./gh";
import { projectCountBucket } from "./manager";

const DRAFT_TIMEOUT_MS = 600_000;
const MAX_NAME_CHARS = 60;
const MAX_SUMMARY_CHARS = 200;
const MAX_INSTRUCTIONS_CHARS = 30_000;
const MAX_NOTE_CHARS = 300;

/** What `origin` and GitHub say about one project. */
export interface ProjectOrigin {
  path: string;
  /** `owner/name`, when `origin` is on GitHub. */
  slug: string | null;
  visibility: BlueprintVisibility | null;
  isTemplate: boolean;
}

/** `git@github.com:o/n.git` or `https://github.com/o/n` → `o/n`. */
export function githubSlug(remoteUrl: string): string | null {
  const match = remoteUrl
    .trim()
    .match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);

  return match ? `${match[1]}/${match[2]}` : null;
}

async function readOrigin(projectPath: string): Promise<ProjectOrigin> {
  const origin: ProjectOrigin = {
    path: projectPath,
    slug: null,
    visibility: null,
    isTemplate: false,
  };
  const url = await runGit(["remote", "get-url", "origin"], projectPath).catch(
    () => "",
  );
  origin.slug = githubSlug(url);
  if (!origin.slug) {
    return origin;
  }
  try {
    const raw = await runGh(
      ["repo", "view", origin.slug, "--json", "isTemplate,visibility"],
      projectPath,
    );
    const parsed = JSON.parse(raw) as {
      isTemplate?: boolean;
      visibility?: string;
    };
    origin.isTemplate = parsed.isTemplate === true;
    origin.visibility =
      parsed.visibility?.toLowerCase() === "public" ? "public" : "private";
  } catch {
    // No `gh`, or no access: the draft just goes without these hints.
  }

  return origin;
}

const SYSTEM_PROMPT =
  "You write blueprints for Argus, an agentic IDE: recipes an agent follows to start a new project modelled on existing ones. You only read files; you never write, run or post anything. You reply with a single JSON object and nothing else.";

export function buildDraftPrompt(origins: ProjectOrigin[]): string {
  const projects = origins
    .map(
      (o) =>
        `- ${o.path}${o.slug ? ` (github.com/${o.slug}${o.isTemplate ? ", a template repository" : ""})` : ""}`,
    )
    .join("\n");
  const several = origins.length > 1;

  return [
    "Draft an Argus blueprint from the projects below.",
    "",
    "A blueprint is handed to an agent that starts in a brand-new, empty repository",
    "for a new app. Its instructions say how to set the new app up the same way as",
    "these projects.",
    "",
    "## Projects",
    projects,
    "",
    "## Read each project",
    "Use Read, Grep and Glob at the absolute paths above. Look at: the stack and",
    "package manager, the folder layout, build and test setup, code signing, CI and",
    "release workflows (`.github/workflows`), update feeds, `.argus.json`, and the",
    "conventions in CLAUDE.md / AGENTS.md / README.",
    several
      ? "\nKeep only what the projects have in common. Leave out anything unique to one app."
      : "",
    "",
    "## Reply with",
    "```json",
    "{",
    '  "name": "Short blueprint name, e.g. \\"SwiftUI Mac app\\"",',
    '  "summary": "One sentence for the picker",',
    '  "instructions": "Markdown for the agent. Name concrete files to mirror, e.g. \\"copy .github/workflows/release.yml from <path>, swap the bundle id\\". Use {{name}} and {{description}} for the new app.",',
    '  "references": [{ "path": "absolute path from the list above", "note": "what to take from it" }],',
    '  "copy_project_settings_from": "the absolute path whose Argus run commands and setup fit the new app best, or null"',
    "}",
    "```",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Collapse whitespace and cap, cutting at a word boundary. */
export function clip(value: unknown, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  const cut = collapsed.slice(0, maxChars);
  const space = cut.lastIndexOf(" ");

  return space > maxChars / 2 ? cut.slice(0, space) : cut;
}

/** The model's answer, held to the projects actually given. Pure. */
export function sanitizeBlueprintDraft(
  raw: unknown,
  origins: ProjectOrigin[],
): BlueprintDraft | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const instructions =
    typeof obj.instructions === "string"
      ? obj.instructions.trim().slice(0, MAX_INSTRUCTIONS_CHARS)
      : "";
  if (!instructions) {
    return null;
  }

  const paths = origins.map((o) => o.path);
  const notes = new Map<string, string>();
  if (Array.isArray(obj.references)) {
    for (const ref of obj.references as unknown[]) {
      if (ref && typeof ref === "object") {
        const r = ref as Record<string, unknown>;
        const refPath = typeof r.path === "string" ? path.resolve(r.path) : "";
        if (paths.includes(refPath)) {
          notes.set(refPath, clip(r.note, MAX_NOTE_CHARS));
        }
      }
    }
  }

  const copyFrom =
    typeof obj.copy_project_settings_from === "string"
      ? path.resolve(obj.copy_project_settings_from)
      : null;

  const template = origins.find((o) => o.isTemplate && o.slug);
  const scaffold: BlueprintScaffold = template?.slug
    ? { kind: "github_template", repo: template.slug }
    : { kind: "empty" };
  const onGithub = origins.find((o) => o.slug);

  return {
    name: clip(obj.name, MAX_NAME_CHARS) || "New blueprint",
    summary: clip(obj.summary, MAX_SUMMARY_CHARS),
    parent_dir: path.dirname(paths[0]),
    instructions,
    scaffold,
    github: {
      enabled: Boolean(onGithub),
      owner: onGithub?.slug?.split("/")[0] ?? "",
      visibility: onGithub?.visibility ?? "private",
    },
    references: paths.map((p) => ({ path: p, note: notes.get(p) ?? "" })),
    copy_project_settings_from:
      copyFrom && paths.includes(copyFrom) ? copyFrom : paths[0],
  };
}

export async function draftBlueprintFromProjects(
  rawPaths: string[],
): Promise<BlueprintDraft> {
  const paths = [...new Set(rawPaths.map((p) => path.resolve(p)))];
  const bucket = projectCountBucket(paths.length);
  const fail = (message: string): never => {
    telemetryCapture("blueprint_drafted", {
      project_count_bucket: bucket,
      saved: false,
      success: false,
    });
    throw message;
  };
  if (paths.length === 0) {
    fail("Pick at least one project to draft from.");
  }
  for (const p of paths) {
    if (!fs.existsSync(path.join(p, ".git"))) {
      fail(`${p} is not a git repository.`);
    }
  }

  const origins = await Promise.all(paths.map(readOrigin));
  const result = await runClaudePrint({
    prompt: buildDraftPrompt(origins),
    cwd: paths[0],
    addDirs: paths.slice(1),
    model: "sonnet",
    source: "blueprint_draft",
    systemPrompt: SYSTEM_PROMPT,
    tools: ["Read", "Grep", "Glob"],
    timeoutMs: DRAFT_TIMEOUT_MS,
  });
  if (!result) {
    fail(
      "Claude could not be reached to draft the blueprint. Check that `claude` is on your PATH and logged in, then try again.",
    );
  }

  const parsed = extractJsonObject(result ?? "");
  const draft = parsed ? sanitizeBlueprintDraft(parsed, origins) : null;
  if (!draft) {
    warn("blueprint draft: unusable reply");

    return fail("Claude did not return a usable blueprint. Try again.");
  }
  telemetryCapture("blueprint_drafted", {
    project_count_bucket: bucket,
    saved: false,
    success: true,
  });

  return draft;
}
