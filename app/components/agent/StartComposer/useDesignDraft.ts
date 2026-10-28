import type { DesignRef } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { isFigmaUrl } from "../../../lib/designViewer";
import { getFigmaDesignRef, listIntegrations } from "../../../lib/ipc";
import { capture } from "../../../lib/telemetry";
import { pushError } from "../../../stores/notificationsStore";

/** A design the agent should match; `issueId` scopes it to one issue's agent. */
export interface DraftDesign {
  issueId: string | null;
  ref: DesignRef;
}

/** Pasted text that is nothing but a Figma link. */
function isPastedFigmaLink(text: string): boolean {
  return isFigmaUrl(text) && !/\s/.test(text.trim());
}

/** Figma frames attached to the agent about to start. */
export function useDesignDraft(initial: DraftDesign[] = []) {
  const [connected, setConnected] = useState(false);
  const [designs, setDesigns] = useState<DraftDesign[]>(initial);
  const [adding, setAdding] = useState(0);

  const refreshConnected = useCallback(() => {
    listIntegrations().then(
      (all) =>
        setConnected(
          all.some((s) => s.id === "figma" && s.connected && !s.needsReauth),
        ),
      () => setConnected(false),
    );
  }, []);
  useEffect(refreshConnected, [refreshConnected]);
  useIpcEvent("integration_status_changed", refreshConnected);

  const add = useCallback(
    async (url: string, issueId: string | null = null) => {
      setAdding((n) => n + 1);
      try {
        const ref = await getFigmaDesignRef(url);
        if (ref) {
          capture("design_ref_added", { from: issueId ? "issue" : "paste" });
          setDesigns((current) =>
            current.some((d) => d.ref.url === ref.url)
              ? current
              : [...current, { issueId, ref }],
          );
        }
      } catch (err) {
        pushError(
          err instanceof Error ? err.message : String(err),
          "figma_design",
        );
      } finally {
        setAdding((n) => n - 1);
      }
    },
    [],
  );

  const remove = useCallback((url: string) => {
    setDesigns((current) => current.filter((d) => d.ref.url !== url));
  }, []);

  /** Drop the designs an issue brought along when the issue goes. */
  const removeForIssue = useCallback((issueId: string) => {
    setDesigns((current) => current.filter((d) => d.issueId !== issueId));
  }, []);

  /** A pasted Figma link becomes a design; anything else goes to `fallback`. */
  const pasteOr = useCallback(
    (fallback: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void) =>
      (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const text = e.clipboardData.getData("text/plain").trim();
        if (connected && isPastedFigmaLink(text)) {
          e.preventDefault();
          add(text);

          return;
        }
        fallback(e);
      },
    [add, connected],
  );

  return {
    add,
    pasteOr,
    adding: adding > 0,
    clear: () => setDesigns([]),
    connected,
    designs,
    remove,
    removeForIssue,
  };
}

export type DesignDraft = ReturnType<typeof useDesignDraft>;
