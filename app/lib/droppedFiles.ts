/**
 * Turning a dropped file into a path the agent can open.
 *
 * Locally that is just the file's own path. Attached to a host it is not: the
 * drop happened on this laptop, and the agent runs on the other Mac, so the
 * bytes are uploaded and the host's staging path comes back instead.
 */

import { readFileAsBase64 } from "./imageAttachments";
import { uploadSessionAttachment } from "./ipc";
import { isRemoteMode } from "./transport";

/**
 * Largest file that may be uploaded to a host, mirroring `MAX_UPLOAD_BYTES` in
 * `electron/services/file/uploads.ts`. Checked here so an oversize drop fails
 * before spending time base64-encoding it.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface ResolvedDrop {
  /** One message per file that could not be made available to the agent. */
  errors: string[];
  /** Host-side paths, ready to be @-mentioned. */
  paths: string[];
}

/**
 * Resolve dropped files to paths on whichever machine holds the session.
 *
 * Never partially uploads: a file over the cap is reported, the rest still go
 * through.
 */
export async function resolveDroppedFilePaths(
  sessionId: string | undefined,
  files: File[],
): Promise<ResolvedDrop> {
  if (!isRemoteMode()) {
    const paths = files
      .map((file) => window.argus.getFilePath?.(file) ?? "")
      .filter((p) => p.length > 0);

    return { paths, errors: [] };
  }

  const paths: string[] = [];
  const errors: string[] = [];
  if (!sessionId) {
    return { paths, errors: ["Open a session before attaching files."] };
  }

  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      errors.push(oversizeMessage(file));
      continue;
    }
    try {
      const data = await readFileAsBase64(file);
      const uploaded = await uploadSessionAttachment(
        sessionId,
        file.name || "attachment",
        data,
      );
      paths.push(uploaded.path);
    } catch (err) {
      errors.push(
        `Could not attach "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { paths, errors };
}

function oversizeMessage(file: File): string {
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  const cap = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

  return `"${file.name}" is ${mb} MB — files sent to a connected host are capped at ${cap} MB.`;
}
