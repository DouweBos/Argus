/**
 * Turning a dropped file into a path the agent can open.
 *
 * Locally that is just the file's own path — nothing is serialised. Attached to
 * a host it is not: the drop happened on this laptop, and the agent runs on the
 * other Mac, so the bytes are uploaded and the host's staging path comes back
 * instead. Hosts that speak the chunked transfer channel take the file whole;
 * anything older falls back to the single base64 envelope and its small cap.
 */

import { blobSource, type TransferProgress } from "@argus/remote-client";
import { readFileAsBase64 } from "./imageAttachments";
import { uploadSessionAttachment } from "./ipc";
import { getTransportForCommand, isRemoteMode } from "./transport";

/**
 * Largest file a host will stage, mirroring `MAX_UPLOAD_BYTES` in
 * `packages/host/src/services/file/uploads.ts`. Checked here so an oversize
 * drop fails before spending time reading it.
 */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** What one base64 JSON envelope can still carry, for hosts without chunking. */
export const MAX_BASE64_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface ResolvedDrop {
  /** One message per file that could not be made available to the agent. */
  errors: string[];
  /** Host-side paths, ready to be @-mentioned. */
  paths: string[];
}

/** Progress across the whole drop, so the UI can show one bar for N files. */
export interface DropProgress extends TransferProgress {
  count: number;
  /** 1-based index of the moving file within the drop. */
  index: number;
  /** The file currently moving. */
  name: string;
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
  onProgress?: (progress: DropProgress | null) => void,
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

  const transfers = getTransportForCommand("upload_session_attachment", {
    id: sessionId,
  }).transfers;
  const limit = transfers ? MAX_UPLOAD_BYTES : MAX_BASE64_UPLOAD_BYTES;

  try {
    for (const [index, file] of files.entries()) {
      if (file.size > limit) {
        errors.push(oversizeMessage(file, limit));
        continue;
      }
      const name = file.name || "attachment";
      try {
        if (transfers) {
          const uploaded = await transfers.upload(
            { purpose: "attachment", sessionId, name },
            blobSource(file),
            (p) =>
              onProgress?.({
                ...p,
                name,
                index: index + 1,
                count: files.length,
              }),
          );
          paths.push(uploaded.path);
        } else {
          const data = await readFileAsBase64(file);
          const uploaded = await uploadSessionAttachment(sessionId, name, data);
          paths.push(uploaded.path);
        }
      } catch (err) {
        errors.push(
          `Could not attach "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    onProgress?.(null);
  }

  return { paths, errors };
}

function oversizeMessage(file: File, limit: number): string {
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  const cap = Math.round(limit / (1024 * 1024));

  return `"${file.name}" is ${mb} MB — files sent to a connected host are capped at ${cap} MB.`;
}
