/**
 * Structured automation reports — data, never markup.
 *
 * A run's agent picks *structure and data*; Peacock owns every pixel. The union
 * is closed and validated here so a malformed block from a model is rejected at
 * the boundary instead of rendered. It lives in the protocol package because a
 * report reaches a paired client as readily as the desktop.
 */

import { z } from "zod";

/** Semantic colouring a list item may ask for. Maps to Peacock tokens. */
export const ReportTone = z.enum(["critical", "info", "positive", "warning"]);
export type ReportTone = z.infer<typeof ReportTone>;

const MAX_ITEMS = 200;

export const ReportHeadingBlock = z.object({
  type: z.literal("heading"),
  text: z.string().min(1).max(200),
});

export const ReportMarkdownBlock = z.object({
  type: z.literal("markdown"),
  text: z.string(),
});

export const ReportStatsBlock = z.object({
  type: z.literal("stats"),
  items: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string(),
        /** Signed change vs the previous period; sign picks the tone. */
        delta: z.number().optional(),
      }),
    )
    .min(1)
    .max(8),
});

export const ReportTableBlock = z.object({
  type: z.literal("table"),
  columns: z.array(z.string()).min(1).max(12),
  rows: z.array(z.array(z.union([z.string(), z.number()]))).max(MAX_ITEMS),
});

export const ReportListBlock = z.object({
  type: z.literal("list"),
  items: z
    .array(
      z.object({
        text: z.string().min(1),
        href: z.string().optional(),
        tone: ReportTone.optional(),
      }),
    )
    .max(MAX_ITEMS),
});

export const ReportSeriesBlock = z.object({
  type: z.literal("series"),
  kind: z.enum(["bar", "line"]),
  /** One label per value — a mismatch is a malformed block. */
  labels: z.array(z.string()).min(1).max(60),
  values: z.array(z.number().finite()).min(1).max(60),
  /** Optional caption naming the measure, e.g. "Merged PRs". */
  label: z.string().max(80).optional(),
});

/** Renders live proposal cards, resolved by id — never a snapshot. */
export const ReportProposalsBlock = z.object({
  type: z.literal("proposals"),
  ids: z.array(z.string().min(1)).max(MAX_ITEMS),
});

/** Renders live session cards, resolved by id — never a snapshot. */
export const ReportSessionsBlock = z.object({
  type: z.literal("sessions"),
  ids: z.array(z.string().min(1)).max(MAX_ITEMS),
});

const ReportBlockUnion = z.discriminatedUnion("type", [
  ReportHeadingBlock,
  ReportMarkdownBlock,
  ReportStatsBlock,
  ReportTableBlock,
  ReportListBlock,
  ReportSeriesBlock,
  ReportProposalsBlock,
  ReportSessionsBlock,
]);

export const ReportBlock = ReportBlockUnion.superRefine((block, ctx) => {
  if (block.type === "series" && block.labels.length !== block.values.length) {
    ctx.addIssue({
      code: "custom",
      message: "series labels and values must be the same length",
      path: ["values"],
    });
  }
  if (block.type === "table") {
    const bad = block.rows.findIndex((r) => r.length !== block.columns.length);
    if (bad >= 0) {
      ctx.addIssue({
        code: "custom",
        message: "every table row must have one cell per column",
        path: ["rows", bad],
      });
    }
  }
});
export type ReportBlock = z.infer<typeof ReportBlockUnion>;

/** The document an agent emits in place of a markdown report. */
export const ReportDocument = z.object({
  blocks: z.array(ReportBlock).min(1).max(64),
});
export type ReportDocument = z.infer<typeof ReportDocument>;

const FENCE = /```argus-report\s*\n([\s\S]*?)```/;

/**
 * Pull structured blocks out of an agent's report, or return null so the caller
 * falls back to rendering it as plain markdown. Accepts either a report that is
 * entirely the JSON document or one that carries it in an ```argus-report
 * fence; anything that does not validate is markdown.
 */
export function parseReportBlocks(text: string | null): ReportBlock[] | null {
  if (!text) {
    return null;
  }
  const fenced = FENCE.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    return null;
  }
  const doc = ReportDocument.safeParse(
    Array.isArray(json) ? { blocks: json } : json,
  );

  return doc.success ? doc.data.blocks : null;
}
