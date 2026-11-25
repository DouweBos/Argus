/**
 * Office and RTF files mentioned in a message (`@path`, as attachments are
 * sent) have their text appended, so the agent gets the content and not only
 * a path it has no tool to open.
 */

import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";
import { capture } from "../telemetry/telemetry";
import {
  documentKind,
  extractDocumentText,
  MAX_DOCUMENT_CHARS,
} from "./documentText";

/** More than this many documents in one message are left as paths. */
const MAX_DOCUMENTS = 5;

/** `@path` tokens, spaces escaped as `\ ` the way the composers write them. */
export function mentionedPaths(message: string): string[] {
  const paths = new Set<string>();
  for (const [, raw] of message.matchAll(/(?:^|\s)@((?:\\ |\S)+)/g)) {
    const unescaped = (raw ?? "").replace(/\\ /g, " ").replace(/[.,;:)]+$/, "");
    if (documentKind(unescaped)) {
      paths.add(unescaped);
    }
  }

  return [...paths];
}

/**
 * Where a mention lives on disk: relative to the worktree, or absolute. A
 * remote sender (`anywhere: false`) only reaches inside the worktree.
 */
async function resolve(
  root: string,
  mention: string,
  anywhere: boolean,
): Promise<string | null> {
  const absolute = path.resolve(root, mention);
  const real = await fs.promises.realpath(absolute).catch(() => null);
  if (!real) {
    return null;
  }
  if (anywhere) {
    return real;
  }
  const base = await fs.promises.realpath(root).catch(() => root);

  return real === base || real.startsWith(base + path.sep) ? real : null;
}

function block(mention: string, text: string): string {
  const truncated = text.length > MAX_DOCUMENT_CHARS;
  const body = truncated ? text.slice(0, MAX_DOCUMENT_CHARS) : text;
  const note = truncated
    ? `\n[Truncated after ${String(MAX_DOCUMENT_CHARS)} characters; open the file for the rest.]`
    : "";

  return `<attached-document path="${mention.replace(/"/g, "&quot;")}">\n${body}${note}\n</attached-document>`;
}

/**
 * `message` with a text block per mentioned document that could be read;
 * unchanged when it mentions none.
 */
export async function withAttachedDocumentText(
  sessionId: string,
  message: string,
  options: { anywhere: boolean },
): Promise<string> {
  const mentions = mentionedPaths(message).slice(0, MAX_DOCUMENTS);
  const root = appState.sessions.get(sessionId)?.path;
  if (mentions.length === 0 || !root) {
    return message;
  }
  const blocks: string[] = [];
  for (const mention of mentions) {
    const kind = documentKind(mention);
    const file = await resolve(root, mention, options.anywhere);
    if (!kind || !file) {
      continue;
    }
    const text = await extractDocumentText(file, kind).catch(() => null);
    capture("attachment_text_extracted", {
      kind,
      success: Boolean(text),
    });
    if (text) {
      blocks.push(block(mention, text));
    }
  }

  return blocks.length > 0 ? `${message}\n\n${blocks.join("\n\n")}` : message;
}
