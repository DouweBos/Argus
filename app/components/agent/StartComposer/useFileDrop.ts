import { type RefObject, useCallback } from "react";
import { resolveDroppedFilePaths } from "../../../lib/droppedFiles";
import { insertFileMentions } from "../../../lib/insertFileMentions";
import { pushError } from "../../../stores/notificationsStore";

/** Dropped images attach; any other file becomes an `@` mention in the prompt. */
export function useFileDrop(
  sessionId: string,
  addImages: (files: File[]) => unknown,
  promptRef: RefObject<HTMLTextAreaElement | null>,
  setPrompt: (next: string) => void,
) {
  return useCallback(
    (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) {
        return;
      }
      e.preventDefault();
      addImages(files.filter((f) => f.type.startsWith("image/")));
      const others = files.filter((f) => !f.type.startsWith("image/"));
      if (others.length > 0) {
        // Attached to a host, the drop is uploaded before it can be mentioned.
        resolveDroppedFilePaths(sessionId, others)
          .then(({ paths, errors }) => {
            errors.forEach((message) => pushError(message, "attachment"));
            insertFileMentions(promptRef.current, paths, setPrompt);
          })
          .catch((err: unknown) => pushError(String(err), "attachment"));
      }
    },
    [addImages, promptRef, sessionId, setPrompt],
  );
}
