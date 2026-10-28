import type { LinearIssue, LinearIssueContext } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  getLinearIssueContext,
  listIntegrations,
  listLinearIssues,
} from "../../../lib/ipc";
import { pushError } from "../../../stores/notificationsStore";

const SEARCH_DEBOUNCE_MS = 250;
const LINEAR_ISSUE_URL =
  /^https?:\/\/linear\.app\/[^/\s]+\/issue\/[A-Za-z0-9]+-\d+\S*$/;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Linear issues attached to the agent about to start, and the picker that finds them. */
export function useIssueDraft() {
  const [connected, setConnected] = useState(false);
  const [issues, setIssues] = useState<LinearIssueContext[]>([]);
  const [adding, setAdding] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinearIssue[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const refreshConnected = useCallback(() => {
    listIntegrations().then(
      (all) =>
        setConnected(
          all.some((s) => s.id === "linear" && s.connected && !s.needsReauth),
        ),
      () => setConnected(false),
    );
  }, []);
  useEffect(refreshConnected, [refreshConnected]);
  useIpcEvent("integration_status_changed", refreshConnected);

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      listLinearIssues(query.trim() || null).then(
        (found) => {
          if (!cancelled) {
            setResults(found);
            setSearchError(null);
            setSearching(false);
          }
        },
        (err: unknown) => {
          if (!cancelled) {
            setSearchError(message(err));
            setSearching(false);
          }
        },
      );
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickerOpen, query]);

  const attach = useCallback(async (ref: string) => {
    setAdding((n) => n + 1);
    try {
      const context = await getLinearIssueContext(ref);
      if (!context) {
        pushError(`Linear has no issue ${ref}.`, "linear_issue");

        return;
      }
      setIssues((current) =>
        current.some((c) => c.issue.id === context.issue.id)
          ? current
          : [...current, context],
      );
    } catch (err) {
      pushError(message(err), "linear_issue");
    } finally {
      setAdding((n) => n - 1);
    }
  }, []);

  const remove = useCallback((id: string) => {
    setIssues((current) => current.filter((c) => c.issue.id !== id));
  }, []);

  const toggle = useCallback(
    (issue: { id: string; identifier: string }) => {
      if (issues.some((c) => c.issue.id === issue.id)) {
        remove(issue.id);
      } else {
        attach(issue.identifier);
      }
    },
    [attach, issues, remove],
  );

  /** A pasted Linear issue link becomes an attachment; anything else goes to `fallback`. */
  const pasteOr = useCallback(
    (fallback: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void) =>
      (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const text = e.clipboardData.getData("text/plain").trim();
        if (connected && LINEAR_ISSUE_URL.test(text)) {
          e.preventDefault();
          attach(text);

          return;
        }
        fallback(e);
      },
    [attach, connected],
  );

  return {
    adding: adding > 0,
    clear: () => setIssues([]),
    handleClosePicker: () => setPickerOpen(false),
    connected,
    issues,
    pasteOr,
    pickerOpen,
    query,
    remove,
    results,
    searchError,
    searching,
    handleQueryChange: setQuery,
    handleTogglePicker: () => setPickerOpen((open) => !open),
    handleToggle: toggle,
  };
}

export type IssueDraft = ReturnType<typeof useIssueDraft>;
