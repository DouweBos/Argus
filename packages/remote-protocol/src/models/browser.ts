import { z } from "zod";

/** The viewport an embedded browser renders at. */
export const BrowserPreset = z.object({
  internalHeight: z.number(),
  internalWidth: z.number(),
  screenPosition: z.enum(["desktop", "mobile"]).optional(),
  userAgent: z.string().optional(),
});
export type BrowserPreset = z.infer<typeof BrowserPreset>;

/** Where to point DevTools at a session's browser. Loopback addresses only. */
export const BrowserDevtools = z.object({
  /** Chromium's remote-debugging port on 127.0.0.1. */
  port: z.number(),
  targetId: z.string(),
  /** The page's CDP endpoint, `ws://127.0.0.1:<port>/devtools/page/<id>`. */
  webSocketDebuggerUrl: z.string(),
  /** DevTools for that page, served by the browser itself. */
  devtoolsFrontendUrl: z.string(),
});
export type BrowserDevtools = z.infer<typeof BrowserDevtools>;
