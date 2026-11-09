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

/** A rectangle in the page's CSS pixels, relative to the viewport. */
export const BrowserRect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BrowserRect = z.infer<typeof BrowserRect>;

/** The element under a point, for the picker's hover highlight. */
export const BrowserElementHit = z.object({
  /** Short, e.g. `button.primary`. */
  label: z.string(),
  bounds: BrowserRect,
  /** The viewport's CSS size, to map `bounds` onto the screencast. */
  viewport: z.object({ width: z.number(), height: z.number() }),
});
export type BrowserElementHit = z.infer<typeof BrowserElementHit>;

/** A picked element: what an agent needs to find and change it. */
export const BrowserElement = BrowserElementHit.extend({
  /** A CSS selector that matches it, unique on the page when one could be built. */
  selector: z.string(),
  tagName: z.string(),
  /** Its visible text, trimmed and capped. */
  text: z.string().optional(),
  /** id, class, role, aria-*, data-*, href, … — the ones that identify it. */
  attributes: z.record(z.string(), z.string()),
  /** A handful of computed styles that differ from the defaults. */
  styles: z.record(z.string(), z.string()),
  /** Its opening tag and children, capped. */
  html: z.string(),
  /** The nearest React component around it, when the page runs React. */
  component: z.string().optional(),
  /** `file:line` of that component's JSX, when React's dev build records it. */
  source: z.string().optional(),
  url: z.string(),
  /** A PNG crop of the element, base64; absent when it's off screen. */
  screenshot: z.string().optional(),
});
export type BrowserElement = z.infer<typeof BrowserElement>;
