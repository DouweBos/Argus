/**
 * Self-managed prereq checklist. Used by both the onboarding Preflight step
 * and Settings → Plugins row. Takes a filtered list of prereq ids, runs them
 * once on mount, and renders Peacock `ChecklistRow`s with Fix actions where
 * the backend supports an automated fixer.
 *
 * Metadata (titles, install commands, URLs) lives in `./meta.ts`.
 */

import type { PrereqId, PrereqResult, PrereqStatus } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ChecklistRow,
  CodeBlock,
  FormField,
  Input,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  checkPrereqs,
  openExternalUrl,
  runPrereqFixer,
} from "../../../lib/ipc";
import styles from "./PrereqList.module.css";
import { PREREQ_META } from "./meta";

interface PrereqListProps {
  ids: PrereqId[];
  /**
   * Notify the caller when results change. Onboarding's Preflight uses this
   * to gate its Continue button on `allRequiredOk`. Settings doesn't.
   */
  onResults?: (results: Record<PrereqId, PrereqResult>) => void;
}

export function PrereqList({ ids, onResults }: PrereqListProps) {
  const [results, setResults] = useState<Record<string, PrereqResult>>({});
  const [fixing, setFixing] = useState<PrereqId | null>(null);
  const [busy, setBusy] = useState(false);

  // Live updates from the backend during a check run land on the same event
  // every preflight invocation uses. Filter to the ids this list cares about.
  const idSet = new Set(ids);
  useIpcEvent<PrereqResult>("onboarding:prereq_update", (r) => {
    if (!idSet.has(r.id)) {
      return;
    }
    setResults((prev) => {
      const next = { ...prev, [r.id]: r };
      onResults?.(next as Record<PrereqId, PrereqResult>);

      return next;
    });
  });

  // Restart checks when the id-set changes by content, not by array
  // reference — callers commonly pass a freshly-built `ids` each render.
  const idsKey = ids.join(",");
  const runChecks = useCallback(async () => {
    setBusy(true);
    try {
      const fresh = await checkPrereqs(ids);
      const asMap = Object.fromEntries(fresh.map((r) => [r.id, r])) as Record<
        string,
        PrereqResult
      >;
      setResults(asMap);
      onResults?.(asMap as Record<PrereqId, PrereqResult>);
    } finally {
      setBusy(false);
    }
    // `ids` is reduced to its content via `idsKey` so we don't refetch on every
    // render when the caller passes a freshly-built array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, onResults]);

  useEffect(() => {
    runChecks().catch(() => {});
  }, [runChecks]);

  const onFix = async (
    id: PrereqId,
    args?: { gitEmail?: string; gitName?: string },
  ) => {
    setFixing(id);
    try {
      await runPrereqFixer(id, args);
      const refreshed = await checkPrereqs([id]);
      const refreshedMap = Object.fromEntries(
        refreshed.map((r) => [r.id, r]),
      ) as Record<string, PrereqResult>;
      setResults((prev) => {
        const next = { ...prev, ...refreshedMap };
        onResults?.(next as Record<PrereqId, PrereqResult>);

        return next;
      });
    } finally {
      setFixing(null);
    }
  };

  return (
    <div className={styles.list}>
      {ids.map((id) => {
        const result = results[id];
        const meta = PREREQ_META[id];
        const status: PrereqStatus = result?.status ?? "running";
        const isFixing = fixing === id;
        const showInstall =
          !isFixing && (status === "fail" || status === "warn");
        const isGitIdentity = id === "git_identity";
        const showIdentityForm =
          isGitIdentity && status !== "pass" && status !== "running";

        return (
          <ChecklistRow
            key={id}
            title={meta.title}
            message={isFixing ? "Installing…" : result?.message}
            tone={isFixing ? "running" : status}
            detail={result?.detail}
            action={
              result?.fixable && !isGitIdentity ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isFixing}
                  onClick={() => {
                    onFix(id).catch(() => {});
                  }}
                >
                  {isFixing ? "Installing…" : "Install"}
                </Button>
              ) : undefined
            }
          >
            {showIdentityForm ? (
              <GitIdentityForm
                busy={isFixing}
                onSubmit={(gitName, gitEmail) => {
                  onFix("git_identity", { gitName, gitEmail }).catch(() => {});
                }}
              />
            ) : null}
            {!showIdentityForm && showInstall && meta.installCommand ? (
              <CodeBlock code={meta.installCommand} />
            ) : null}
            {!showIdentityForm && showInstall && meta.installUrl ? (
              <div className={styles.installLine}>
                <span>How to install:</span>
                <button
                  type="button"
                  className={styles.installLink}
                  onClick={() => {
                    openExternalUrl(meta.installUrl!).catch(() => {});
                  }}
                >
                  {meta.installLabel ?? meta.installUrl}
                </button>
              </div>
            ) : null}
          </ChecklistRow>
        );
      })}
      {ids.length > 0 && (
        <div className={styles.rerun}>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              runChecks().catch(() => {});
            }}
          >
            Re-run checks
          </Button>
        </div>
      )}
    </div>
  );
}

interface GitIdentityFormProps {
  busy: boolean;
  onSubmit: (name: string, email: string) => void;
}

function GitIdentityForm({ busy, onSubmit }: GitIdentityFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const valid = name.trim().length > 0 && /.+@.+\..+/.test(email.trim());

  return (
    <div className={styles.identityForm}>
      <FormField label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your Name"
          disabled={busy}
        />
      </FormField>
      <FormField label="Email">
        <Input
          value={email}
          type="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={busy}
        />
      </FormField>
      <div className={styles.identityActions}>
        <Button
          variant="primary"
          size="sm"
          disabled={!valid || busy}
          onClick={() => onSubmit(name.trim(), email.trim())}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
