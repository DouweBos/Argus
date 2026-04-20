import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Icons, Input, SegmentedCard } from "@argus/peacock";
import { useProjectWorkspaces } from "../../../hooks/useWorkspaces";
import {
  getUserProjectSettings,
  listAllBranches,
  setUserProjectSettings,
} from "../../../lib/ipc";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface CreateWorkspaceDialogProps {
  onClose: () => void;
  repoRoot: string;
  /** When set, the new workspace forks from this workspace's branch instead of project root HEAD. */
  sourceWorkspace?: { branch: string; display_name?: string | null } | null;
}

type Flow = "adopt-local" | "adopt-remote" | "branch-off" | "pick";

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

/** Mirror of backend applyBranchPrefix: prepend prefix unless already present. */
function applyBranchPrefix(branch: string, prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed) {
    return branch;
  }
  if (branch.startsWith(trimmed)) {
    return branch;
  }

  return `${trimmed}${branch}`;
}

/** Cheap preview slug matching backend titleToBranchSlug shape. */
function previewSlug(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return cleaned || "workspace";
}

export function CreateWorkspaceDialog({
  repoRoot,
  onClose,
  sourceWorkspace,
}: CreateWorkspaceDialogProps) {
  const { workspaces, createWorkspace } = useProjectWorkspaces(repoRoot);

  const [flow, setFlow] = useState<Flow>(sourceWorkspace ? "branch-off" : "pick");

  // branch-off state
  const [sourceBranch, setSourceBranch] = useState<string>(
    sourceWorkspace?.branch ?? "",
  );
  const [sourceQuery, setSourceQuery] = useState("");
  const [description, setDescription] = useState("");
  const [newBranch, setNewBranch] = useState("");

  // adopt state
  const [adoptBranch, setAdoptBranch] = useState("");
  const [adoptQuery, setAdoptQuery] = useState("");
  const [adoptDescription, setAdoptDescription] = useState("");

  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-developer branch prefix (stored in ~/.argus, not .argus.json).
  const [branchPrefix, setBranchPrefix] = useState("");
  const [prefixDraft, setPrefixDraft] = useState("");
  const [editingPrefix, setEditingPrefix] = useState(false);

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
      .catch(() => {
        // Non-fatal: prefix just stays empty.
      });

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

  const descriptionRef = useRef<HTMLInputElement>(null);

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
        workspaces.filter((w) => w.kind === "worktree").map((w) => w.branch),
      ),
    [workspaces],
  );

  const adoptableLocal = useMemo(
    () => localBranches.filter((b) => !claimedBranches.has(b)),
    [localBranches, claimedBranches],
  );
  const adoptableRemote = useMemo(
    () => remoteBranches.filter((b) => !claimedBranches.has(b)),
    [remoteBranches, claimedBranches],
  );

  const trimmedNewBranch = newBranch.trim();
  const trimmedDescription = description.trim();

  // Effective branch name: explicit if given, else derived from description.
  const rawBranch = trimmedNewBranch.length
    ? trimmedNewBranch
    : trimmedDescription;
  const effectiveBranch = rawBranch
    ? applyBranchPrefix(rawBranch, branchPrefix)
    : "";
  const effectiveSlug = effectiveBranch ? previewSlug(effectiveBranch) : "";

  const branchCollision =
    effectiveSlug.length > 0 &&
    (localBranches.includes(effectiveSlug) ||
      remoteBranches.includes(effectiveSlug) ||
      claimedBranches.has(effectiveSlug));

  const canSubmitBranchOff =
    !!sourceBranch && !!effectiveSlug && !branchCollision;
  const canSubmitAdoptLocal = !!adoptBranch;
  const canSubmitAdoptRemote = !!adoptBranch;

  const submit = async (
    branch: string,
    desc: string,
    useExisting: boolean,
    baseBranch: string | undefined,
  ) => {
    setIsCreating(true);
    setError(null);
    try {
      await createWorkspace(branch, desc, useExisting, baseBranch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSubmitBranchOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitBranchOff) {
      return;
    }
    // Pass the effective display name (before slugging) so backend can use it
    // as the humanized display_name while slugging it for the branch.
    await submit(effectiveBranch, trimmedDescription, false, sourceBranch);
  };

  const handleSubmitAdopt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adoptBranch) {
      return;
    }
    await submit(adoptBranch, adoptDescription.trim(), true, undefined);
  };

  const goPick = () => {
    setFlow("pick");
    setAdoptBranch("");
    setAdoptQuery("");
    setAdoptDescription("");
    setNewBranch("");
    setDescription("");
    setError(null);
  };

  const title = "New Session";

  // ---- Step: pick flow ----
  if (flow === "pick") {
    return (
      <Dialog
        className={styles.dialogLarge}
        title={title}
        titleId="create-ws-title"
        onClose={onClose}
      >
        <div className={styles.form}>
          <p className={styles.bodyText}>How do you want to start?</p>
          <div className={styles.flowPicker}>
            <SegmentedCard
              icon={<Icons.BranchIcon size={18} />}
              title="Branch off"
              description="Fork from an existing branch into a new working branch."
              onClick={() => {
                setFlow("branch-off");
                setTimeout(() => descriptionRef.current?.focus(), 0);
              }}
            />
            <SegmentedCard
              icon={<Icons.RepoIcon size={18} />}
              title="Local branch"
              description="Open an existing local branch in a new worktree."
              disabled={adoptableLocal.length === 0}
              onClick={() => setFlow("adopt-local")}
            />
            <SegmentedCard
              icon={<Icons.PullIcon size={18} />}
              title="Remote branch"
              description="Check out an existing remote branch in a new worktree."
              disabled={adoptableRemote.length === 0}
              onClick={() => setFlow("adopt-remote")}
            />
          </div>
          <div className={styles.footer}>
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // ---- Step: branch-off ----
  if (flow === "branch-off") {
    const localSuggestions = filterBranches(localBranches, sourceQuery);
    const remoteSuggestions = filterBranches(remoteBranches, sourceQuery);
    const hasSuggestions =
      localSuggestions.length > 0 || remoteSuggestions.length > 0;

    let sourceListBody: ReactNode;
    if (branchesLoading) {
      sourceListBody = (
        <div className={styles.branchListEmpty}>Loading branches…</div>
      );
    } else if (!hasSuggestions) {
      sourceListBody = (
        <div className={styles.branchListEmpty}>No matching branches</div>
      );
    } else {
      sourceListBody = (
        <>
          {localSuggestions.length > 0 && (
            <>
              <div className={styles.branchSectionHeader}>Local</div>
              {localSuggestions.map((b) => (
                <button
                  key={b}
                  className={`${styles.branchItem} ${b === sourceBranch ? styles.branchItemSelected : ""}`}
                  type="button"
                  onClick={() => {
                    setSourceBranch(b);
                    setSourceQuery("");
                  }}
                >
                  {b}
                </button>
              ))}
            </>
          )}
          {remoteSuggestions.length > 0 && (
            <>
              <div className={styles.branchSectionHeader}>Remote</div>
              {remoteSuggestions.map((b) => (
                <button
                  key={`remote:${b}`}
                  className={`${styles.branchItem} ${b === sourceBranch ? styles.branchItemSelected : ""}`}
                  type="button"
                  onClick={() => {
                    setSourceBranch(b);
                    setSourceQuery("");
                  }}
                >
                  {b}
                </button>
              ))}
            </>
          )}
        </>
      );
    }

    let branchHint: ReactNode = null;
    if (branchCollision) {
      branchHint = (
        <span className={styles.errorMsg}>
          Branch &quot;{effectiveSlug}&quot; already exists. Use &ldquo;Local branch&rdquo;
          instead.
        </span>
      );
    } else if (effectiveSlug) {
      branchHint = (
        <span className={styles.createNewHint}>
          New branch: <strong>{effectiveSlug}</strong>
          {sourceBranch && (
            <>
              {" "}
              from <strong>{sourceBranch}</strong>
            </>
          )}
        </span>
      );
    }

    return (
      <Dialog
        className={styles.dialogLarge}
        title={title}
        titleExtra={<span className={styles.subtitle}>Branch off</span>}
        titleId="create-ws-title"
        onClose={onClose}
      >
        <form className={styles.form} onSubmit={handleSubmitBranchOff}>
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
            <label className={styles.label} htmlFor="new-branch-input">
              Branch name{" "}
              <span className={styles.labelHint}>
                (optional — generated from description)
              </span>
            </label>
            <Input
              autoComplete="off"
              id="new-branch-input"
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

          {!sourceWorkspace && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="source-branch-input">
                Source branch
              </label>
              <Input
                autoComplete="off"
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
              <div className={styles.branchList}>{sourceListBody}</div>
            </div>
          )}

          {error && <p className={styles.errorMsg}>{error}</p>}

          <div className={styles.footer}>
            {!sourceWorkspace && (
              <Button variant="secondary" type="button" onClick={goPick}>
                Back
              </Button>
            )}
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={isCreating || !canSubmitBranchOff}
              type="submit"
            >
              {isCreating ? "Creating…" : "Create Session"}
            </Button>
          </div>
        </form>
      </Dialog>
    );
  }

  // ---- Step: adopt-local / adopt-remote ----
  const isRemote = flow === "adopt-remote";
  const pool = isRemote ? adoptableRemote : adoptableLocal;
  const filteredPool = filterBranches(pool, adoptQuery);
  const subtitle = isRemote ? "Remote branch" : "Local branch";

  let adoptListBody: ReactNode;
  if (branchesLoading) {
    adoptListBody = (
      <div className={styles.branchListEmpty}>Loading branches…</div>
    );
  } else if (pool.length === 0) {
    adoptListBody = (
      <div className={styles.branchListEmpty}>
        No {isRemote ? "remote" : "local"} branches available
      </div>
    );
  } else if (filteredPool.length === 0) {
    adoptListBody = (
      <div className={styles.branchListEmpty}>No matching branches</div>
    );
  } else {
    adoptListBody = filteredPool.map((b) => (
      <button
        key={b}
        className={`${styles.branchItem} ${b === adoptBranch ? styles.branchItemSelected : ""}`}
        type="button"
        onClick={() => setAdoptBranch(b)}
      >
        {isRemote ? `origin/${b}` : b}
      </button>
    ));
  }

  return (
    <Dialog
      className={styles.dialogLarge}
      title={title}
      titleExtra={<span className={styles.subtitle}>{subtitle}</span>}
      titleId="create-ws-title"
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={handleSubmitAdopt}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="adopt-branch-input">
            {isRemote ? "Remote branch" : "Local branch"}
          </label>
          <Input
            autoComplete="off"
            autoFocus
            id="adopt-branch-input"
            placeholder="Search branches…"
            type="text"
            value={adoptQuery}
            onChange={(e) => setAdoptQuery(e.target.value)}
          />
          {adoptBranch && (
            <span className={styles.createNewHint}>
              Selected: <strong>{isRemote ? `origin/${adoptBranch}` : adoptBranch}</strong>
            </span>
          )}
          <div className={styles.branchList}>{adoptListBody}</div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="adopt-description-input">
            Description{" "}
            <span className={styles.labelHint}>(optional)</span>
          </label>
          <Input
            id="adopt-description-input"
            placeholder="What's this session for?"
            type="text"
            value={adoptDescription}
            onChange={(e) => setAdoptDescription(e.target.value)}
          />
        </div>

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={goPick}>
            Back
          </Button>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={
              isCreating ||
              (isRemote ? !canSubmitAdoptRemote : !canSubmitAdoptLocal)
            }
            type="submit"
          >
            {isCreating ? "Creating…" : "Create Session"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
