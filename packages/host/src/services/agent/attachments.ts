/**
 * Attachment resolution for MCP spawn/send-message tools.
 *
 * Parent agents (running inside Argus) can forward attachments — typically
 * screenshots the user dropped into their chat — to a child agent's Claude
 * Code subprocess. The MCP tool accepts attachments in one of two shapes:
 *
 *   { path: "/abs/path/to/image.png" }
 *   { data: "<base64>", mime_type: "image/png", name?: "screenshot.png" }
 *
 * Both shapes are normalized here into {@link ImageAttachment} values that
 * match what the existing UI drag-and-drop path writes to the agent's stdin
 * (a base64 image content block in the stream-json payload).
 */
import type { ImageAttachment } from "./claude";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** 25 MB cap per attachment (Anthropic's hard limit for inline base64 is ~5MB, but
 *  cli already splits/compresses as needed; keep a generous ceiling here). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Supported image MIME types (matches Claude API image content block support). */
const SUPPORTED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Extension → MIME mapping for inference from `path`. */
const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Zod schema for a single attachment entry. */
export const mcpAttachmentSchema = z
  .object({
    path: z
      .string()
      .optional()
      .describe(
        "Absolute path to a local file readable by the Argus main process.",
      ),
    data: z
      .string()
      .optional()
      .describe(
        "Base64-encoded attachment bytes (no data-URL prefix). Pair with mime_type.",
      ),
    mime_type: z
      .string()
      .optional()
      .describe(
        "MIME type for base64 data, e.g. 'image/png'. Inferred from file extension when `path` is used.",
      ),
    name: z
      .string()
      .optional()
      .describe(
        "Optional display name — currently used for error messages only.",
      ),
  })
  .describe(
    "Attachment entry. Provide either `path` OR `data`+`mime_type`. Only image mime types are supported today (image/png, image/jpeg, image/gif, image/webp).",
  );

export type McpAttachment = z.infer<typeof mcpAttachmentSchema>;

/**
 * Resolve MCP attachment entries into {@link ImageAttachment} records that
 * can be handed to `sendAgentMessage`.
 *
 * Throws a descriptive `Error` on any validation failure so the MCP tool
 * handler can return it as `isError: true`.
 */
export function resolveAttachments(
  attachments: McpAttachment[] | undefined,
): ImageAttachment[] {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const out: ImageAttachment[] = [];
  for (const [i, a] of attachments.entries()) {
    const label = a.name ?? a.path ?? `#${i}`;

    if (a.path) {
      if (!path.isAbsolute(a.path)) {
        throw new Error(`Attachment ${label}: path must be absolute`);
      }
      let stat;
      try {
        stat = fs.statSync(a.path);
      } catch (e) {
        throw new Error(
          `Attachment ${label}: cannot read file (${(e as Error).message})`,
        );
      }
      if (!stat.isFile()) {
        throw new Error(`Attachment ${label}: not a regular file`);
      }
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `Attachment ${label}: file too large (${stat.size} bytes > ${MAX_ATTACHMENT_BYTES} cap)`,
        );
      }
      const ext = path.extname(a.path).toLowerCase();
      const mime = a.mime_type ?? EXT_TO_MIME[ext];
      if (!mime) {
        throw new Error(
          `Attachment ${label}: cannot infer mime type for extension '${ext}'. Pass mime_type explicitly.`,
        );
      }
      if (!SUPPORTED_MIME.has(mime)) {
        throw new Error(
          `Attachment ${label}: unsupported mime type '${mime}'. Supported: ${[...SUPPORTED_MIME].join(", ")}`,
        );
      }
      const bytes = fs.readFileSync(a.path);
      out.push({ data: bytes.toString("base64"), media_type: mime });

      continue;
    }

    if (a.data) {
      if (!a.mime_type) {
        throw new Error(
          `Attachment ${label}: mime_type is required when using inline data`,
        );
      }
      if (!SUPPORTED_MIME.has(a.mime_type)) {
        throw new Error(
          `Attachment ${label}: unsupported mime type '${a.mime_type}'. Supported: ${[...SUPPORTED_MIME].join(", ")}`,
        );
      }
      // Rough byte count from base64 (3/4 of length, ignoring padding).
      const approxBytes = Math.ceil((a.data.length * 3) / 4);
      if (approxBytes > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `Attachment ${label}: base64 payload too large (~${approxBytes} bytes > ${MAX_ATTACHMENT_BYTES} cap)`,
        );
      }
      out.push({ data: a.data, media_type: a.mime_type });

      continue;
    }

    throw new Error(
      `Attachment ${label}: must provide either 'path' or 'data'+'mime_type'`,
    );
  }

  return out;
}
