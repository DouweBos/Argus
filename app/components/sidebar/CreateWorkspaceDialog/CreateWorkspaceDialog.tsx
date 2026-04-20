import { Button, Input } from "@argus/peacock";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useProjectWorkspaces } from "../../../hooks/useWorkspaces";
import { listAllBranches } from "../../../lib/ipc";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface CreateWorkspaceDialogProps {
  onClose: () => void;
  repoRoot: string;
  /** When set, the new workspace forks from this workspace's branch instead of project root HEAD. */
  sourceWorkspace?: { branch: string; display_name?: string | null } | null;
}

type Step = "details" | "source";
type Mode = "existing" | "new";

function filterBranches(branches: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return branches;
  }

  return branches.filter((b) => b.toLowerCase().includes(q));
}

function pickDefaultSource(local: string[]): string | null {
  if (local.includes("main")) {
    return "main";
  }
  if (local.includes("master")) {
    return "master";
  }

  return local[0] ?? null;
}

export function CreateWorkspaceDialog({
  repoRoot,
  onClose,
  sourceWorkspace,
}: CreateWorkspaceDialogProps) {
  const { workspaces, createWorkspace } = useProjectWorkspaces(repoRoot);

  const [step, setStep] = useState<Step>(sourceWorkspace ? "details" : "source");
  const [sourceBranch, setSourceBranch] = useState<string>(
    sourceWorkspace?.branch ?? "",
  );
  const [sourceQuery, setSourceQuery] = useState("");

  const [mode, setMode] = useState<Mode>("new");
  const [newBranch, setNewBranch] = useState("");
  const [adoptBranch, setAdoptBranch] = useState("");
  const [description, setDescription] = useState("");

  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descriptionRef = useRef<HTMLInputElement>(null);
  const newBranchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setBranchesLoading(true);
    listAllBranches(repoRoot)
      .then((list) => {
        if (cancelled) {
          return;
        }
        setLocalBranches(list.local);
        setRemoteBranches(list.remote);
        if (!sourceWorkspace && !sourceBranch) {
          const def = pickDefaultSource(list.local);
          if (def) {
            setSourceBranch(def);
          }
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setLocalBranches([]);
        setRemoteBranches([]);
      })
      .finally(() => {
        if (!cancelled) {
          setBranchesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, sourceWorkspace, sourceBranch]);

  // Branches already claimed by an existing worktree-kind session.
  const claimedBranches = useMemo(
    () =>
      new Set(
        workspaces
          .filter((w) => w.kind === "worktree")
          .map((w) => w.branch),
      ),
    [workspaces],
  );

  const allBranches = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const b of [...localBranches, ...remoteBranches]) {
      if (!seen.has(b)) {
        seen.add(b);
        merged.push(b);
      }
    }

    return merged;
  }, [localBranches, remoteBranches]);

  const localSourceSuggestions = filterBranches(localBranches, sourceQuery);
  const remoteSourceSuggestions = filterBranches(remoteBranches, sourceQuery);
  const hasSourceSuggestions =
    localSourceSuggestions.length > 0 || remoteSourceSuggestions.length > 0;

  const adoptableBranches = useMemo(
    () =>
      allBranches.filter(
        (b) => b !== sourceBranch && !claimedBranches.has(b),
      ),
    [allBranches, sourceBranch, claimedBranches],
  );

  const trimmedNewBranch = newBranch.trim();
  const newBranchExists =
    trimmedNewBranch.length > 0 &&
    (localBranches.includes(trimmedNewBranch) ||
      remoteBranches.includes(trimmedNewBranch));
  const newBranchClaimed =
    trimmedNewBranch.length > 0 && claimedBranches.has(trimmedNewBranch);

  let newBranchError: string | null = null;
  if (trimmedNewBranch.length === 0) {
    newBranchError = null;
  } else if (newBranchExists) {
    newBranchError = `Branch "${trimmedNewBranch}" already exists. Use "Adopt existing branch" instead.`;
  } else if (newBranchClaimed) {
    newBranchError = `Branch "${trimmedNewBranch}" is already used by another session.`;
  }

  const canContinueFromSource = !!sourceBranch;
  const canSubmit =
    mode === "new"
      ? !!trimmedNewBranch && !newBranchError
      : !!adoptBranch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const branch = mode === "new" ? trimmedNewBranch : adoptBranch;
      await createWorkspace(
        branch,
        description.trim(),
        mode === "existing",
        sourceBranch || undefined,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setIsCreating(false);
    }
  };

  const selectSource = useCallback((b: string) => {
    setSourceBranch(b);
    setSourceQuery("");
  }, []);

  let sourceListBody: ReactNode;
  if (branchesLoading) {
    sourceListBody = (
      <div className={styles.branchListEmpty}>Loading branches…</div>
    );
  } else if (hasSourceSuggestions) {
    sourceListBody = (
      <>
        {localSourceSuggestions.length > 0 && (
          <>
            <div className={styles.branchSectionHeader}>Local</div>
            {localSourceSuggestions.map((b) => (
              <button
                key={b}
                className={`${styles.branchItem} ${b === sourceBranch ? styles.branchItemSelected : ""}`}
                type="button"
                onClick={() => selectSource(b)}
              >
                {b}
              </button>
            ))}
          </>
        )}
        {remoteSourceSuggestions.length > 0 && (
          <>
            <div className={styles.branchSectionHeader}>Remote</div>
            {remoteSourceSuggestions.map((b) => (
              <button
                key={`remote:${b}`}
                className={`${styles.branchItem} ${b === sourceBranch ? styles.branchItemSelected : ""}`}
                type="button"
                onClick={() => selectSource(b)}
              >
                {b}
              </button>
            ))}
          </>
        )}
      </>
    );
  } else {
    sourceListBody = (
      <div className={styles.branchListEmpty}>No matching branches</div>
    );
  }

  const title = "New Session";

  if (step === "source") {
    return (
      <Dialog
        className={styles.dialogLarge}
        title={title}
        titleId="create-ws-title"
        onClose={onClose}
      >
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (canContinueFromSource) {
              setStep("details");
              setTimeout(() => descriptionRef.current?.focus(), 0);
            }
          }}
        >
          <div className={styles.field}>
            <label className={styles.label} htmlFor="source-branch-input">
              Source branch
            </label>
            <Input
              autoComplete="off"
              autoFocus
              id="source-branch-input"
              placeholder="Search branches…"
              type="text"
              value={sourceQuery}
              onChange={(e) => setSourceQuery(e.target.value)}
            />
            {sourceBranch && (
              <span className={styles.createNewHint}>
                Selected: <strong>{sourceBranch}</strong>
              </span>
            )}
          </div>

          <div className={styles.branchList}>{sourceListBody}</div>

          <div className={styles.footer}>
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canContinueFromSource}
              type="submit"
            >
              Continue
            </Button>
          </div>
        </form>
      </Dialog>
    );
  }

  // step === "details"
  return (
    <Dialog
      className={styles.dialogLarge}
      title={title}
      titleExtra={
        <span className={styles.subtitle}>
          from {sourceWorkspace?.display_name ?? sourceBranch}
        </span>
      }
      titleId="create-ws-title"
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="description-input">
            Description
          </label>
          <Input
            ref={descriptionRef}
            autoFocus
            id="description-input"
            placeholder="What are you building?"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Branch</span>
          <div className={styles.modeToggle}>
            <Button
              type="button"
              variant={mode === "new" ? "primary" : "secondary"}
              onClick={() => {
                setMode("new");
                setTimeout(() => newBranchRef.current?.focus(), 0);
              }}
            >
              Create new branch
            </Button>
            <Button
              type="button"
              variant={mode === "existing" ? "primary" : "secondary"}
              disabled={adoptableBranches.length === 0}
              onClick={() => setMode("existing")}
            >
              Adopt existing branch
            </Button>
          </div>
        </div>

        {mode === "new" ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-branch-input">
              New branch name
            </label>
            <Input
              ref={newBranchRef}
              autoComplete="off"
              id="new-branch-input"
              placeholder="e.g. feat/my-feature"
              type="text"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
            />
            {!newBranchError && trimmedNewBranch && (
              <span className={styles.createNewHint}>
                Will create from <strong>{sourceBranch}</strong>
              </span>
            )}
            {newBranchError && (
              <span className={styles.errorMsg}>{newBranchError}</span>
            )}
          </div>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="adopt-branch-select">
              Existing branch
            </label>
            {adoptableBranches.length === 0 ? (
              <span className={styles.createNewHint}>
                No adoptable branches available
              </span>
            ) : (
              <select
                className={styles.input}
                id="adopt-branch-select"
                value={adoptBranch}
                onChange={(e) => setAdoptBranch(e.target.value)}
              >
                <option value="">Choose a branch…</option>
                {adoptableBranches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.footer}>
          {!sourceWorkspace && (
            <Button
              variant="secondary"
              type="button"
              onClick={() => setStep("source")}
            >
              Back
            </Button>
          )}
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={isCreating || !canSubmit}
            type="submit"
          >
            {isCreating ? "Creating…" : "Create Session"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
