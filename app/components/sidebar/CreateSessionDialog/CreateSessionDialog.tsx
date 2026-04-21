import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button, Icons, Input, SegmentedCard, TextArea } from "@argus/peacock";
import { useProjectSessions } from "../../../hooks/useSessions";
import {
  startAgentInSession,
  sendUserMessageToAgent,
} from "../../../lib/agentLifecycle";
import { forkChatFromMessage } from "../../../lib/forkChat";
import {
  getUserProjectSettings,
  listAllBranches,
  setUserProjectSettings,
} from "../../../lib/ipc";
import { pushError } from "../../../stores/notificationsStore";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface CreateSessionDialogProps {
  /**
   * When set, submitting the branch-off flow forks the chat at `messageId`
   * instead of creating an empty session. Requires `sourceSession` to be set.
   */
  forkContext?: {
    agentId: string;
    messageId: string;
    sourceSessionId: string;
  } | null;
  onClose: () => void;
  repoRoot: string;
  /** When set, the new session forks from this session's branch instead of project root HEAD. */
  sourceSession?: { branch: string; display_name?: string | null } | null;
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
const PREVIEW_SLUG_MAX_LENGTH = 50;

function previewSlug(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!cleaned) {
    return "session";
  }
  if (cleaned.length <= PREVIEW_SLUG_MAX_LENGTH) {
    return cleaned;
  }
  const head = cleaned.slice(0, PREVIEW_SLUG_MAX_LENGTH);
  const lastHyphen = head.lastIndexOf("-");
  const cut =
    lastHyphen > PREVIEW_SLUG_MAX_LENGTH / 2 ? head.slice(0, lastHyphen) : head;

  return (
    cut.replace(/[-_]+$/g, "") || cleaned.slice(0, PREVIEW_SLUG_MAX_LENGTH)
  );
}

interface BranchSection {
  branches: string[];
  formatDisplay?: (b: string) => string;
  label: string;
}

interface BranchDropdownProps {
  loading?: boolean;
  onChange: (branch: string) => void;
  placeholder?: string;
  sections: BranchSection[];
  value: string;
}

function BranchDropdown({
  sections,
  value,
  onChange,
  loading = false,
  placeholder = "Select a branch…",
}: BranchDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [popoverRect, setPopoverRect] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    setPopoverRect({ left: r.left, top: r.bottom + 4, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  // Close on outside click (wrapper + portaled popover count as inside)
  useEffect(() => {
    if (!open) {
      return;
    }

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) {
        return;
      }
      if (popoverRef.current?.contains(target)) {
        return;
      }
      close();
    };

    document.addEventListener("mousedown", handler);

    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) {
      return;
    }

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };

    document.addEventListener("keydown", handler);

    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  // Focus search when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const filteredSections = sections.map((s) => ({
    ...s,
    filtered: filterBranches(s.branches, query),
  }));

  const hasAny = filteredSections.some((s) => s.filtered.length > 0);

  // Find display label for current value
  const displayValue = (() => {
    for (const s of sections) {
      if (s.branches.includes(value)) {
        return s.formatDisplay ? s.formatDisplay(value) : value;
      }
    }

    return value || null;
  })();

  let listContent: ReactNode;
  if (loading) {
    listContent = (
      <div className={styles.branchListEmpty}>Loading branches…</div>
    );
  } else if (!hasAny) {
    listContent = (
      <div className={styles.branchListEmpty}>
        {query ? "No matching branches" : "No branches available"}
      </div>
    );
  } else {
    listContent = filteredSections.map((s) =>
      s.filtered.length === 0 ? null : (
        <div key={s.label}>
          {sections.length > 1 && (
            <div className={styles.branchSectionHeader}>{s.label}</div>
          )}
          {s.filtered.map((b) => {
            const display = s.formatDisplay ? s.formatDisplay(b) : b;

            return (
              <button
                key={`${s.label}:${b}`}
                className={`${styles.branchItem} ${b === value ? styles.branchItemSelected : ""}`}
                type="button"
                role="option"
                aria-selected={b === value}
                onClick={() => {
                  onChange(b);
                  close();
                }}
              >
                {display}
              </button>
            );
          })}
        </div>
      ),
    );
  }

  return (
    <div className={styles.branchDropdownWrapper} ref={wrapperRef}>
      <button
        ref={triggerRef}
        className={styles.branchDropdownTrigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={
            displayValue
              ? styles.branchDropdownValue
              : styles.branchDropdownPlaceholder
          }
        >
          {displayValue ?? placeholder}
        </span>
        <Icons.ChevronDownIcon
          size={10}
          className={`${styles.branchDropdownChevron} ${open ? styles.branchDropdownChevronOpen : ""}`}
        />
      </button>

      {open &&
        popoverRect &&
        createPortal(
          <div
            ref={popoverRef}
            className={styles.branchDropdownPopover}
            role="listbox"
            style={{
              left: popoverRect.left,
              top: popoverRect.top,
              width: popoverRect.width,
            }}
          >
            <div className={styles.branchDropdownSearch}>
              <Input
                ref={searchRef}
                autoComplete="off"
                placeholder="Search branches…"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className={styles.branchDropdownList}>{listContent}</div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function getSubmitLabel(isFork: boolean): string {
  return isFork ? "Fork Session" : "Start Session";
}

export function CreateSessionDialog({
  repoRoot,
  onClose,
  sourceSession,
  forkContext,
}: CreateSessionDialogProps) {
  const { sessions, createSession } = useProjectSessions(repoRoot);

  const [flow, setFlow] = useState<Flow>(sourceSession ? "branch-off" : "pick");

  // branch-off state
  const [sourceBranch, setSourceBranch] = useState<string>(
    sourceSession?.branch ?? "",
  );
  const [description, setDescription] = useState("");
  const [newBranch, setNewBranch] = useState("");

  // adopt state
  const [adoptBranch, setAdoptBranch] = useState("");
  const [adoptDescription, setAdoptDescription] = useState("");

  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);

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

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    listAllBranches(repoRoot)
      .then((list) => {
        if (cancelled) {
          return;
        }
        setLocalBranches(list.local);
        setRemoteBranches(list.remote);
        if (!sourceSession && !sourceBranch) {
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
  }, [repoRoot, sourceSession, sourceBranch]);

  // Branches already claimed by an existing worktree-kind session.
  const claimedBranches = useMemo(
    () =>
      new Set(
        sessions.filter((w) => w.kind === "worktree").map((w) => w.branch),
      ),
    [sessions],
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

  // Effective branch name: only shown when the user explicitly typed one.
  // When empty, the backend generates a branch name from the prompt via
  // `claude -p`, so we don't need to compute or display a preview here.
  const effectiveBranch = trimmedNewBranch
    ? applyBranchPrefix(trimmedNewBranch, branchPrefix)
    : "";
  const effectiveSlug = effectiveBranch ? previewSlug(effectiveBranch) : "";

  const branchCollision =
    effectiveSlug.length > 0 &&
    (localBranches.includes(effectiveSlug) ||
      remoteBranches.includes(effectiveSlug) ||
      claimedBranches.has(effectiveSlug));

  const canSubmitBranchOff =
    !!sourceBranch && !!trimmedDescription && !branchCollision;
  const canSubmitAdoptLocal = !!adoptBranch;
  const canSubmitAdoptRemote = !!adoptBranch;

  const submit = (
    branch: string,
    desc: string,
    useExisting: boolean,
    baseBranch: string | undefined,
    initialPrompt?: string,
  ) => {
    // Close the dialog immediately — branch name generation and worktree
    // setup can take several seconds (claude -p title generation, git
    // worktree add, copy/symlink pipeline). The session renders in the
    // sidebar with an `initializing` status while the backend finishes.
    onClose();

    (async () => {
      try {
        if (forkContext && !useExisting) {
          await forkChatFromMessage(
            forkContext.sourceSessionId,
            forkContext.agentId,
            forkContext.messageId,
            branch,
            desc,
          );
        } else {
          const session = await createSession(
            branch,
            desc,
            useExisting,
            baseBranch,
          );
          // Spawn an agent immediately with the user's prompt as the first
          // message. The session's worktree already exists by the time
          // createSession resolves — the setup pipeline (copy/symlink/install)
          // continues in the background but does not block agent startup.
          if (initialPrompt && session) {
            const agentInfo = await startAgentInSession(session.id, {
              focus: true,
            });
            await sendUserMessageToAgent(
              agentInfo.agent_id,
              initialPrompt,
              undefined,
              { assumeIdle: true },
            );
          }
        }
      } catch (err) {
        // useProjectSessions.createSession already reports its own errors,
        // but fork/agent-start paths do not — surface everything here so the
        // user sees a notification instead of silently losing the session.
        pushError(
          err instanceof Error ? err.message : "Failed to create session",
          "create_session",
        );
      }
    })();
  };

  const handleSubmitBranchOff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitBranchOff) {
      return;
    }
    // When the user typed a branch, pass it (prefix applied). When empty,
    // pass "" — the backend generates a branch name + title from the prompt.
    submit(
      effectiveBranch,
      trimmedDescription,
      false,
      sourceBranch,
      trimmedDescription,
    );
  };

  const handleSubmitAdopt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adoptBranch) {
      return;
    }
    submit(adoptBranch, adoptDescription.trim(), true, undefined);
  };

  const goPick = () => {
    setFlow("pick");
    setAdoptBranch("");
    setAdoptDescription("");
    setNewBranch("");
    setDescription("");
    setError(null);
  };

  const title = forkContext ? "Fork Session" : "New Session";

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
    let branchHint: ReactNode = null;
    if (branchCollision) {
      branchHint = (
        <span className={styles.errorMsg}>
          Branch &quot;{effectiveSlug}&quot; already exists. Use &ldquo;Local
          branch&rdquo; instead.
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
    } else if (trimmedDescription) {
      branchHint = (
        <span className={styles.createNewHint}>
          Branch name will be generated from your prompt
          {sourceBranch && (
            <>
              , branching from <strong>{sourceBranch}</strong>
            </>
          )}
          .
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
              Prompt{" "}
              <span className={styles.labelHint}>
                (sent to the agent as the first message)
              </span>
            </label>
            <TextArea
              ref={descriptionRef}
              autoFocus
              id="description-input"
              placeholder="What are you building? Describe the task the agent should pick up."
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === "Enter" &&
                  canSubmitBranchOff
                ) {
                  e.preventDefault();
                  handleSubmitBranchOff(e as unknown as React.FormEvent);
                }
              }}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-branch-input">
              Branch name{" "}
              <span className={styles.labelHint}>
                (optional — generated from prompt)
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

          {!sourceSession && (
            <div className={styles.field}>
              <label className={styles.label}>Source branch</label>
              <BranchDropdown
                sections={[
                  { label: "Local", branches: localBranches },
                  { label: "Remote", branches: remoteBranches },
                ]}
                value={sourceBranch}
                onChange={setSourceBranch}
                loading={branchesLoading}
                placeholder="Select a branch…"
              />
            </div>
          )}

          {error && <p className={styles.errorMsg}>{error}</p>}

          <div className={styles.footer}>
            {!sourceSession && (
              <Button variant="secondary" type="button" onClick={goPick}>
                Back
              </Button>
            )}
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canSubmitBranchOff}
              type="submit"
            >
              {getSubmitLabel(Boolean(forkContext))}
            </Button>
          </div>
        </form>
      </Dialog>
    );
  }

  // ---- Step: adopt-local / adopt-remote ----
  const isRemote = flow === "adopt-remote";
  const pool = isRemote ? adoptableRemote : adoptableLocal;
  const subtitle = isRemote ? "Remote branch" : "Local branch";

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
          <label className={styles.label}>
            {isRemote ? "Remote branch" : "Local branch"}
          </label>
          <BranchDropdown
            sections={[
              {
                label: isRemote ? "Remote" : "Local",
                branches: pool,
                formatDisplay: isRemote ? (b) => `origin/${b}` : undefined,
              },
            ]}
            value={adoptBranch}
            onChange={setAdoptBranch}
            loading={branchesLoading}
            placeholder={`Select a ${isRemote ? "remote" : "local"} branch…`}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="adopt-description-input">
            Description <span className={styles.labelHint}>(optional)</span>
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
            disabled={isRemote ? !canSubmitAdoptRemote : !canSubmitAdoptLocal}
            type="submit"
          >
            Create Session
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
