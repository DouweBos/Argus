import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, TextArea } from "@argus/peacock";
import { forkChatFromMessage } from "../../../lib/forkChat";
import {
  getUserProjectSettings,
  listAllBranches,
  setUserProjectSettings,
} from "../../../lib/ipc";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface ForkSessionDialogProps {
  agentId: string;
  messageId: string;
  onClose: () => void;
  repoRoot: string;
  sourceSessionId: string;
}

function applyBranchPrefix(branch: string, prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed || branch.startsWith(trimmed)) {
    return branch;
  }

  return `${trimmed}${branch}`;
}

function previewSlug(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return cleaned || "session";
}

export function ForkSessionDialog({
  repoRoot,
  onClose,
  sourceSessionId,
  agentId,
  messageId,
}: ForkSessionDialogProps) {
  const [description, setDescription] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [isForking, setIsForking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [claimedBranches, setClaimedBranches] = useState<Set<string>>(new Set());

  const [branchPrefix, setBranchPrefix] = useState("");
  const [prefixDraft, setPrefixDraft] = useState("");
  const [editingPrefix, setEditingPrefix] = useState(false);

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    getUserProjectSettings(repoRoot)
      .then((s) => {
        if (cancelled) {
          return;
        }
        setBranchPrefix(s.branch_prefix ?? "");
        setPrefixDraft(s.branch_prefix ?? "");
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  useEffect(() => {
    let cancelled = false;
    listAllBranches(repoRoot)
      .then((list) => {
        if (cancelled) {
          return;
        }
        setLocalBranches(list.local);
        setRemoteBranches(list.remote);
        setClaimedBranches(new Set([...list.local, ...list.remote]));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  const savePrefix = async () => {
    const next = prefixDraft.trim();
    try {
      const saved = await setUserProjectSettings(repoRoot, {
        branch_prefix: next,
      });
      setBranchPrefix(saved.branch_prefix ?? "");
      setPrefixDraft(saved.branch_prefix ?? "");
      setEditingPrefix(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save prefix");
    }
  };

  const trimmedNewBranch = newBranch.trim();
  const trimmedDescription = description.trim();

  const effectiveBranch = trimmedNewBranch
    ? applyBranchPrefix(trimmedNewBranch, branchPrefix)
    : "";
  const effectiveSlug = effectiveBranch ? previewSlug(effectiveBranch) : "";

  const branchCollision =
    effectiveSlug.length > 0 &&
    (localBranches.includes(effectiveSlug) ||
      remoteBranches.includes(effectiveSlug) ||
      claimedBranches.has(effectiveSlug));

  const canSubmit = !!trimmedDescription && !branchCollision;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    setIsForking(true);
    setError(null);
    try {
      await forkChatFromMessage(
        sourceSessionId,
        agentId,
        messageId,
        effectiveBranch,
        trimmedDescription,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fork session");
    } finally {
      setIsForking(false);
    }
  };

  let branchHint: ReactNode = null;
  if (branchCollision) {
    branchHint = (
      <span className={styles.errorMsg}>
        Branch &quot;{effectiveSlug}&quot; already exists.
      </span>
    );
  } else if (effectiveSlug) {
    branchHint = (
      <span className={styles.createNewHint}>
        New branch: <strong>{effectiveSlug}</strong>
      </span>
    );
  } else if (trimmedDescription) {
    branchHint = (
      <span className={styles.createNewHint}>
        Branch name will be generated from your description.
      </span>
    );
  }

  return (
    <Dialog
      className={styles.dialogLarge}
      title="Fork Session"
      titleId="fork-session-title"
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="fork-description-input">
            Description
          </label>
          <TextArea
            ref={descriptionRef}
            autoFocus
            id="fork-description-input"
            placeholder="What's this fork for?"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (
                (e.metaKey || e.ctrlKey) &&
                e.key === "Enter" &&
                canSubmit &&
                !isForking
              ) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent).catch(() => {});
              }
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="fork-branch-input">
            Branch name{" "}
            <span className={styles.labelHint}>
              (optional — generated from description)
            </span>
          </label>
          <Input
            autoComplete="off"
            id="fork-branch-input"
            placeholder="e.g. feat/my-feature"
            type="text"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
          />
          {branchHint}
          <div className={styles.prefixRow}>
            {editingPrefix ? (
              <>
                <Input
                  autoComplete="off"
                  placeholder="e.g. douwe/"
                  type="text"
                  value={prefixDraft}
                  onChange={(e) => setPrefixDraft(e.target.value)}
                />
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    setPrefixDraft(branchPrefix);
                    setEditingPrefix(false);
                  }}
                >
                  Cancel
                </Button>
                <Button variant="primary" type="button" onClick={savePrefix}>
                  Save
                </Button>
              </>
            ) : (
              <span className={styles.labelHint}>
                {branchPrefix ? (
                  <>
                    Personal prefix: <strong>{branchPrefix}</strong>
                  </>
                ) : (
                  <>No personal branch prefix set.</>
                )}{" "}
                <button
                  className={styles.linkButton}
                  type="button"
                  onClick={() => setEditingPrefix(true)}
                >
                  {branchPrefix ? "Change" : "Set one"}
                </button>
              </span>
            )}
          </div>
        </div>

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={isForking || !canSubmit} type="submit">
            {isForking ? "Forking…" : "Fork Session"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
