import { useCallback, useRef } from "react";
import {
  loadOlderTranscript,
  TRANSCRIPT_PAGE,
} from "../../../lib/transcriptSync";
import {
  getConversationState,
  trimTranscript,
} from "../../../stores/conversationStore";

/**
 * Older history lives on the host; this fetches it a page at a time as the
 * reader scrolls up, and lets it go again once they are back at the bottom.
 */
export function useOlderTranscript(agentId: string | null | undefined): {
  /** Messages added in front, or 0 when there is nothing older to load. */
  loadOlder: () => Promise<number>;
  releaseOlder: () => void;
} {
  const loading = useRef(false);

  const loadOlder = useCallback(async () => {
    if (!agentId || loading.current) {
      return 0;
    }
    const before =
      getConversationState().conversations[agentId]?.messages.length ?? 0;
    loading.current = true;
    try {
      if (!(await loadOlderTranscript(agentId))) {
        return 0;
      }
    } catch {
      return 0;
    } finally {
      loading.current = false;
    }
    const after =
      getConversationState().conversations[agentId]?.messages.length ?? 0;

    return Math.max(0, after - before);
  }, [agentId]);

  const releaseOlder = useCallback(() => {
    if (agentId) {
      trimTranscript(agentId, TRANSCRIPT_PAGE);
    }
  }, [agentId]);

  return { loadOlder, releaseOlder };
}
