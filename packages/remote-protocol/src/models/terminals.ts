import { z } from "zod";

/** A live terminal, so a client can rehydrate its tabs after a reload. */
export const TerminalSummary = z.object({
  exitCode: z.number().nullable(),
  exited: z.boolean(),
  id: z.string(),
  runTitle: z.string().nullable(),
  sessionId: z.string(),
  title: z.string().nullable(),
});
export type TerminalSummary = z.infer<typeof TerminalSummary>;

export const RunTerminalResult = z.object({
  /**
   * Dependency terminals newly spawned for the entry's `requires` chain, in
   * dependency-first order. Clients register them as tabs too; without them
   * the PTY runs invisibly on the host.
   */
  dependencies: z.array(z.object({ sessionId: z.string(), title: z.string() })),
  sessionId: z.string(),
  /** False when an already-running terminal was reused. */
  started: z.boolean(),
  title: z.string(),
});
export type RunTerminalResult = z.infer<typeof RunTerminalResult>;
