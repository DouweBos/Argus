import { z } from "zod";

/**
 * What a phone's Live Activity shows for one host: the agents worth a glance,
 * waiting ones first. The same shape is sealed into every pushed update.
 */
export const RemoteLiveActivityAgent = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  project: z.string().nullable(),
  state: z.enum(["working", "needsYou", "done", "failed"]),
  /** Unix ms; the phone counts elapsed time from it. */
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  /** The tool it is on, in a few words. */
  step: z.string().nullable(),
  /** A permission prompt Approve/Deny can answer. */
  prompt: z.object({ toolUseId: z.string(), summary: z.string() }).nullable(),
});
export type RemoteLiveActivityAgent = z.infer<typeof RemoteLiveActivityAgent>;

export const RemoteLiveActivitySnapshot = z.object({
  agents: z.array(RemoteLiveActivityAgent),
  /** Agents past the cut. */
  more: z.number(),
});
export type RemoteLiveActivitySnapshot = z.infer<
  typeof RemoteLiveActivitySnapshot
>;
