/**
 * How drafted commit messages and pull requests should read: the repository's
 * own conventions, or the user's instructions from Settings.
 */

import fs from "node:fs";
import path from "node:path";
import { loadAppSettings } from "../appSettings/store";
import { git } from "./git";

export type MessageStyleMode = "conventions" | "custom";

const RECENT_SUBJECTS = 30;
const MAX_INSTRUCTIONS_CHARS = 8_000;
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"];

export interface MessageStyle {
  mode: MessageStyleMode;
  /** Prompt section describing the style to follow. */
  guidance: string;
}

/** Custom instructions win only when there are some; otherwise the repo decides. */
export function messageStyleMode(): MessageStyleMode {
  const settings = loadAppSettings();

  return settings.commit_message_style === "custom" &&
    settings.commit_message_instructions?.trim()
    ? "custom"
    : "conventions";
}

export async function resolveMessageStyle(cwd: string): Promise<MessageStyle> {
  if (messageStyleMode() === "custom") {
    const rules = loadAppSettings().commit_message_instructions?.trim() ?? "";

    return {
      mode: "custom",
      guidance: `Follow these instructions for the message's style:\n\n${rules}`,
    };
  }

  const sections = [
    "Match this repository's conventions: the format, tense, casing and length of its recent commit subjects, and any commit or pull-request rules in its agent instructions. Those rules override your defaults — when they forbid a commit body, write the subject alone.",
  ];
  const subjects = await recentSubjects(cwd);
  if (subjects) {
    sections.push(`Recent commit subjects:\n\n${subjects}`);
  }
  for (const file of INSTRUCTION_FILES) {
    const text = readCapped(path.join(cwd, file));
    if (text) {
      sections.push(`${file}:\n\n${text}`);
    }
  }

  return { mode: "conventions", guidance: sections.join("\n\n") };
}

async function recentSubjects(cwd: string): Promise<string> {
  try {
    return (
      await git(cwd, [
        "log",
        "--no-merges",
        `-n${RECENT_SUBJECTS}`,
        "--pretty=format:- %s",
      ])
    ).trim();
  } catch {
    return "";
  }
}

function readCapped(file: string): string {
  try {
    const text = fs.readFileSync(file, "utf8").trim();

    return text.length > MAX_INSTRUCTIONS_CHARS
      ? `${text.slice(0, MAX_INSTRUCTIONS_CHARS)}\n…`
      : text;
  } catch {
    return "";
  }
}
