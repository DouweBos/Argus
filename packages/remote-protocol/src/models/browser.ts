import { z } from "zod";

/** The viewport an embedded browser renders at. */
export const BrowserPreset = z.object({
  internalHeight: z.number(),
  internalWidth: z.number(),
  screenPosition: z.enum(["desktop", "mobile"]).optional(),
  userAgent: z.string().optional(),
});
export type BrowserPreset = z.infer<typeof BrowserPreset>;
