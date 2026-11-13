/**
 * The pure half of review guides: what the diff touches, the prompt that asks
 * for a tour of it, and turning the reply into a guide that covers every file.
 */

import type {
  RemoteReviewGuide,
  RemoteReviewGuideRange,
  RemoteReviewGuideStop,
} from "@argus/remote-protocol";
import { z } from "zod";

export interface PatchFile {
  path: string;
  deleted: boolean;
  additions: number;
  deletions: number;
  /** This file's slice of the patch, `diff --git` header first. */
  text: string;
}

/** Splits a unified diff into files; a deleted file is named by its old path. */
export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  const chunks = patch
    .split(/^(?=diff --git )/m)
    .filter((c) => c.startsWith("diff --git "));
  for (const text of chunks) {
    const header = text.slice(
      0,
      text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"),
    );
    const plus = text.match(/^\+\+\+ (?:b\/)?(.+)$/m)?.[1];
    const minus = text.match(/^--- (?:a\/)?(.+)$/m)?.[1];
    const deleted = plus === "/dev/null";
    const fromHeader = header.match(/ b\/(.+)$/)?.[1];
    const path =
      (deleted ? minus : plus && plus !== "/dev/null" ? plus : fromHeader) ??
      fromHeader;
    if (!path) {
      continue;
    }
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of text.split("\n")) {
      if (line.startsWith("@@")) {
        inHunk = true;
      } else if (inHunk && line.startsWith("+")) {
        additions++;
      } else if (inHunk && line.startsWith("-")) {
        deletions++;
      }
    }
    files.push({ path: path.trim(), deleted, additions, deletions, text });
  }

  return files;
}

export interface GuideContext {
  /** "pull request #12: Add billing" or "the session's branch". */
  subject: string;
  /** The PR's description, when there is one. */
  description?: string;
  baseRef: string;
}

/** Roughly what fits in one prompt next to the instructions. */
export const DIFF_BUDGET = 180_000;

export const GUIDE_SYSTEM_PROMPT =
  "You write review guides: an ordered tour of a code change that a human reviewer works through stop by stop. " +
  "You may read files in the working directory with Read, Grep and Glob to understand the change. Never modify anything. " +
  "Reply with only the JSON object you are asked for, no prose and no code fence.";

export function guidePrompt(files: PatchFile[], context: GuideContext): string {
  const listed = files
    .map(
      (f) =>
        `- ${f.path} (+${f.additions} -${f.deletions}${f.deleted ? ", deleted" : ""})`,
    )
    .join("\n");
  // Smallest first, so one huge generated file can't crowd out the rest.
  let budget = DIFF_BUDGET;
  const included = new Set<string>();
  for (const file of [...files].sort((a, b) => a.text.length - b.text.length)) {
    if (file.text.length <= budget) {
      included.add(file.path);
      budget -= file.text.length;
    }
  }
  const diff = files
    .filter((f) => included.has(f.path))
    .map((f) => f.text)
    .join("");
  const omitted = files
    .filter((f) => !included.has(f.path))
    .map((f) => `- ${f.path}`);

  return [
    `Write a review guide for ${context.subject}, compared with \`${context.baseRef}\`.`,
    context.description
      ? `Its description:\n\n${context.description.trim()}`
      : "",
    `Changed files:\n${listed}`,
    `Rules:
- 4 to 10 stops for the substantive changes, ordered so each builds on the last: the core idea first (types, data model, contracts), then the implementation, then its callers and UI, then tests.
- Each stop: a short title, a 2-5 sentence markdown summary of what changed and why it matters, and \`ranges\` pointing at the specific lines worth reading (not whole files). Lines are the new file's line numbers (side "new"), or the old file's for removed code (side "old").
- \`look_closely\` flags judgement calls the reviewer must make: behaviour changes, edge cases, error handling, security, performance, missing tests. Leave it empty when there are none; don't flag style.
- Mechanical changes (renames, formatting, lockfiles, generated code, snapshots, version bumps, changesets) go in one or two final stops with \`mechanical: true\`.
- Every changed file appears in exactly one stop's \`paths\`.`,
    `Reply with JSON shaped like:
{"overview":"markdown, 2-3 sentences","stops":[{"title":"...","summary":"...","mechanical":false,"paths":["src/a.ts"],"ranges":[{"path":"src/a.ts","side":"new","start":10,"end":24}],"look_closely":[{"note":"...","path":"src/a.ts","line":18}]}]}`,
    omitted.length > 0
      ? `These files' diffs are too large to include; read them if they matter:\n${omitted.join("\n")}`
      : "",
    `The diff:\n\n${diff}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const ReplyRange = z.object({
  path: z.string(),
  side: z.enum(["old", "new"]).catch("new"),
  start: z.coerce.number(),
  end: z.coerce.number().optional(),
});

const ReplyStop = z.object({
  title: z.string().catch("Untitled stop"),
  summary: z.string().catch(""),
  mechanical: z.boolean().catch(false),
  paths: z.array(z.string()).catch([]),
  ranges: z.array(z.unknown()).catch([]),
  look_closely: z.array(z.unknown()).catch([]),
});

const ReplyFlag = z.object({
  note: z.string(),
  path: z.string().nullish(),
  line: z.coerce.number().nullish(),
});

const Reply = z.object({
  overview: z.string().catch(""),
  stops: z.array(ReplyStop),
});

/** The first JSON object in `text`, fenced or not; null when there is none. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The reply as a guide: unknown paths dropped, each file in one stop, the
 * files it skipped added to a closing mechanical stop, mechanical stops last.
 * Null when the reply isn't a guide at all.
 */
export function normalizeGuide(
  reply: string,
  files: PatchFile[],
  meta: { headSha: string; baseRef: string; now?: Date },
): RemoteReviewGuide | null {
  const parsed = Reply.safeParse(extractJson(reply));
  if (!parsed.success || parsed.data.stops.length === 0) {
    return null;
  }
  const known = new Map(files.map((f) => [f.path, f]));
  const claimed = new Set<string>();
  const stops: RemoteReviewGuideStop[] = [];
  for (const stop of parsed.data.stops) {
    const ranges = stop.ranges.flatMap((raw): RemoteReviewGuideRange[] => {
      const range = ReplyRange.safeParse(raw);
      if (
        !range.success ||
        !known.has(range.data.path) ||
        !(range.data.start > 0)
      ) {
        return [];
      }
      const start = Math.floor(range.data.start);
      const end = Math.max(start, Math.floor(range.data.end ?? start));
      const side = known.get(range.data.path)?.deleted
        ? "old"
        : range.data.side;

      return [{ path: range.data.path, side, start, end }];
    });
    const paths = [...stop.paths, ...ranges.map((r) => r.path)].filter(
      (p, i, all) => known.has(p) && !claimed.has(p) && all.indexOf(p) === i,
    );
    paths.forEach((p) => claimed.add(p));
    if (paths.length === 0 && ranges.length === 0) {
      continue;
    }
    const look_closely = stop.look_closely.flatMap((raw) => {
      const flag = ReplyFlag.safeParse(raw);
      if (!flag.success || !flag.data.note.trim()) {
        return [];
      }
      const path =
        flag.data.path && known.has(flag.data.path) ? flag.data.path : null;
      const line =
        path && flag.data.line && flag.data.line > 0
          ? Math.floor(flag.data.line)
          : null;

      return [{ note: flag.data.note.trim(), path, line }];
    });
    stops.push({
      id: "",
      title: stop.title.trim() || "Untitled stop",
      summary: stop.summary.trim(),
      mechanical: stop.mechanical,
      look_closely,
      paths,
      ranges,
    });
  }
  if (stops.length === 0) {
    return null;
  }
  const missed = files.map((f) => f.path).filter((p) => !claimed.has(p));
  if (missed.length > 0) {
    stops.push({
      id: "",
      title: "Everything else",
      summary: "Files the tour didn't stop at. Skim them before you finish.",
      mechanical: true,
      look_closely: [],
      paths: missed,
      ranges: [],
    });
  }
  const ordered = [
    ...stops.filter((s) => !s.mechanical),
    ...stops.filter((s) => s.mechanical),
  ];

  return {
    head_sha: meta.headSha,
    base_ref: meta.baseRef,
    overview: parsed.data.overview.trim(),
    stops: ordered.map((stop, i) => ({ ...stop, id: `s${i + 1}` })),
    generated_at: (meta.now ?? new Date()).toISOString(),
  };
}

/** What a question about one stop is asked with: the guide, the stop, and its files' diffs. */
export function askPrompt(
  guide: RemoteReviewGuide,
  stop: RemoteReviewGuideStop,
  files: PatchFile[],
  question: string,
): string {
  const diffs = files
    .filter((f) => stop.paths.includes(f.path))
    .map((f) => f.text)
    .join("")
    .slice(0, DIFF_BUDGET);
  const ranges = stop.ranges
    .map((r) => `- ${r.path}:${r.start}-${r.end} (${r.side})`)
    .join("\n");

  return [
    `A reviewer is working through a review guide of a change against \`${guide.base_ref}\`.`,
    `The change: ${guide.overview}`,
    `They are at the stop "${stop.title}":\n\n${stop.summary}`,
    ranges ? `It points at:\n${ranges}` : "",
    `Its files' diff:\n\n${diffs}`,
    `Their question: ${question}`,
    "Answer in a few short markdown paragraphs. Read the code if you need to; cite files as path:line.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const ASK_SYSTEM_PROMPT =
  "You answer a code reviewer's question about a change. You may read files with Read, Grep and Glob. Never modify anything. Be direct and concrete.";
