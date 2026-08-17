import type { ProjectEntry } from "../../../lib/types";
import type { PendingImage } from "../../../stores/conversationStore";
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
import {
  Button,
  Chip,
  Icons,
  ImageAttachmentStrip,
  Input,
  SegmentedCard,
  TextArea,
} from "@argus/peacock";
import { useProjectSessions } from "../../../hooks/useSessions";
import { forkChatFromMessage } from "../../../lib/forkChat";
import {
  ACCEPTED_IMAGE_TYPES,
  extractImageFilesFromClipboard,
  filesToPendingImages,
} from "../../../lib/imageAttachments";
import {
  getUserProjectSettings,
  type ImageAttachment,
  listAllBranches,
  listProjects,
  readArgusConfig,
  setUserProjectSettings,
} from "../../../lib/ipc";
import { getLastKnownCapabilities } from "../../../lib/lastKnownCapabilities";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { pushError } from "../../../stores/notificationsStore";
import { useRegisteredRunners } from "../../../stores/runnersStore";
import { selectSession, setPendingPrompt } from "../../../stores/sessionStore";
import { getDefaultModel, useDefaultLlm } from "../../../stores/settingsStore";
import { ModelPicker, type RunnerSelection } from "../../agent/ModelPicker";
import { ProjectPicker } from "../../agent/ProjectPicker";
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

const COMMON_BASE_BRANCHES = ["staging", "develop", "dev", "main", "master"];

/**
 * Pick the branch to preselect as the source branch for a new session.
 *
 * Priority:
 *   1. The project's `.argus.json` `default_base_branch`, then `protected_branches`,
 *      then common base-branch names (`staging`, `develop`, `dev`, `main`, `master`).
 *      For each candidate, prefer `origin/<name>` over the local branch when
 *      the project root has `<name>` checked out — the local copy may have
 *      drifted, so the remote tip is a more reliable base.
 *   2. The first local branch.
 */
function pickDefaultSource(
  local: string[],
  originRefs: string[],
  configured: string | null,
  protectedBranches: string[],
  projectRootBranch: string | null,
): string | null {
  const originSet = new Set(originRefs);
  const candidates = [
    ...(configured ? [configured] : []),
    ...protectedBranches,
    ...COMMON_BASE_BRANCHES,
  ];
  const seen = new Set<string>();
  for (const name of candidates) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const originRef = `origin/${name}`;
    const hasOrigin = originSet.has(originRef);
    const hasLocal = local.includes(name);
    if (hasOrigin && projectRootBranch === name) {
      return originRef;
    }
    if (hasLocal) {
      return name;
    }
    if (hasOrigin) {
      return originRef;
    }
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
  const { sessions, createSession, repoBranch } = useProjectSessions(repoRoot);

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
  const [originRefs, setOriginRefs] = useState<string[]>([]);
  const [protectedBranches, setProtectedBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Model + linked-projects state for the branch-off prompt. These are
  // forwarded to `setPendingPrompt` so the agent that boots from the new
  // session honours both. We pull a model list from any existing
  // conversation's reported capabilities — first-launch with no prior agent
  // means the picker stays hidden.
  const { models: lastKnownModels } = useMemo(
    () => getLastKnownCapabilities(),
    [],
  );
  const [modelValue, setModelValue] = useState<string>(
    () => getDefaultModel() || "default",
  );
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelChipRef = useRef<HTMLDivElement>(null);

  // New-session runner picker. Today only "claude-code" is registered, so
  // the dropdown collapses to a single non-interactive entry — but we
  // drive it from `list_runners` so adding a runner later is purely
  // additive.
  const registeredRunners = useRegisteredRunners();
  const defaultLlm = useDefaultLlm();
  const [runnerId, setRunnerId] = useState<string>(
    () => defaultLlm.runner ?? "claude-code",
  );
  useEffect(() => {
    // Sync from app default once it loads, but never override an explicit
    // user pick.
    if (defaultLlm.runner && runnerId === "claude-code") {
      setRunnerId(defaultLlm.runner);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultLlm.runner]);
  const runnerSelection: RunnerSelection = {
    currentId: runnerId,
    locked: false,
    available: registeredRunners,
    onSelect: setRunnerId,
  };

  const [linkedProjects, setLinkedProjects] = useState<string[]>([]);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [allProjects, setAllProjects] = useState<ProjectEntry[]>([]);
  const projectChipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectPickerOpen) {
      return;
    }
    let cancelled = false;
    listProjects()
      .then((result) => {
        if (!cancelled) {
          setAllProjects(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllProjects([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPickerOpen]);

  const toggleLinkedProject = useCallback((path: string) => {
    setLinkedProjects((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  }, []);

  // A custom runner declares its own models; the cached capabilities only
  // describe the base runner's, which the gateway won't accept.
  const knownModels = useMemo(() => {
    const declared = registeredRunners.find((r) => r.id === runnerId)?.models;

    return declared?.length ? declared : lastKnownModels;
  }, [registeredRunners, runnerId, lastKnownModels]);

  const modelDisplayName = useMemo(() => {
    if (!knownModels.length) {
      return undefined;
    }
    const match = knownModels.find((m) => m.value === modelValue);

    return match?.displayName ?? knownModels[0]?.displayName;
  }, [knownModels, modelValue]);

  const addImageFiles = useCallback(async (files: File[]) => {
    const newImages = await filesToPendingImages(files);
    if (newImages.length > 0) {
      setPendingImages((prev) => [...prev, ...newImages]);
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setPendingImages((prev) => {
      const removed = prev[index];
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }

      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handlePromptPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const imageFiles = extractImageFilesFromClipboard(e);
      if (imageFiles.length > 0) {
        e.preventDefault();
        addImageFiles(imageFiles);
      }
    },
    [addImageFiles],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) {
        return;
      }
      await addImageFiles(Array.from(files));
      e.target.value = "";
      descriptionRef.current?.focus();
    },
    [addImageFiles],
  );

  // Revoke object URLs when the dialog unmounts.
  useEffect(() => {
    return () => {
      for (const img of pendingImages) {
        URL.revokeObjectURL(img.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    Promise.all([
      listAllBranches(repoRoot),
      readArgusConfig(repoRoot).catch(() => null),
    ])
      .then(([list, config]) => {
        if (cancelled) {
          return;
        }
        setLocalBranches(list.local);
        setRemoteBranches(list.remote);
        setOriginRefs(list.originRefs ?? []);
        const protectedList = config?.protected_branches ?? [];
        setProtectedBranches(protectedList);
        const configured = config?.default_base_branch?.trim() || null;
        if (!sourceSession && !sourceBranch) {
          const def = pickDefaultSource(
            list.local,
            list.originRefs ?? [],
            configured,
            protectedList,
            repoBranch,
          );
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
        setOriginRefs([]);
        setProtectedBranches([]);
      })
      .finally(() => {
        if (!cancelled) {
          setBranchesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, sourceSession, sourceBranch, repoBranch]);

  // Branches already claimed by an existing worktree-kind session.
  const claimedBranches = useMemo(
    () =>
      new Set(
        sessions.filter((w) => w.kind === "worktree").map((w) => w.branch),
      ),
    [sessions],
  );

  // Origin refs to surface as source-branch candidates. The dropdown is for
  // picking a base to fork from — flooding it with every `origin/*` ref would
  // be noise. Restrict to the project's protected branches (configured in
  // `.argus.json`), the configured default base, and common defaults.
  const sourceOriginRefs = useMemo(() => {
    const hints = new Set<string>([
      ...protectedBranches,
      ...COMMON_BASE_BRANCHES,
    ]);

    return originRefs.filter((ref) => hints.has(ref.replace(/^origin\//, "")));
  }, [originRefs, protectedBranches]);

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
    initialImages?: ImageAttachment[],
    initialModel?: string,
    initialLinkedProjects?: string[],
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
          // The backend returns with the session in `initializing` status —
          // branch-name generation and worktree creation still run in the
          // background. Starting an agent here would pick the wrong cwd (or
          // fail outright), so record the prompt (and any attached images)
          // against the session id and let `initPendingSessionPrompts`
          // dispatch it once the session transitions to `ready`.
          if (
            (initialPrompt ||
              initialImages?.length ||
              initialLinkedProjects?.length) &&
            session
          ) {
            setPendingPrompt(session.id, initialPrompt || "", {
              images: initialImages?.length ? initialImages : undefined,
              model:
                initialModel && initialModel !== "default"
                  ? initialModel
                  : undefined,
              linkedProjects: initialLinkedProjects?.length
                ? initialLinkedProjects
                : undefined,
            });
          }
          // Focus the freshly-created session so the user lands on its home
          // screen immediately. Setup (copy/symlink/install) keeps running in
          // the background; the home screen reflects the `initializing` state.
          if (session) {
            selectSession(session.id);
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
    const images = pendingImages.map((p) => p.attachment);
    // When the user typed a branch, pass it (prefix applied). When empty,
    // pass "" — the backend generates a branch name + title from the prompt.
    submit(
      effectiveBranch,
      trimmedDescription,
      false,
      sourceBranch,
      trimmedDescription,
      images.length > 0 ? images : undefined,
      modelValue,
      linkedProjects.length > 0 ? linkedProjects : undefined,
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
        size="medium"
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
        size="medium"
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
            <div className={styles.promptWrap}>
              <TextArea
                ref={descriptionRef}
                autoFocus
                id="description-input"
                placeholder="What are you building? Describe the task the agent should pick up."
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onPaste={handlePromptPaste}
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
              <button
                aria-label="Attach image"
                className={styles.promptAttachBtn}
                type="button"
                title="Attach image"
                onClick={() => fileInputRef.current?.click()}
              >
                <Icons.PaperclipIcon />
              </button>
            </div>
            <ImageAttachmentStrip
              className={styles.attachments}
              items={pendingImages}
              onPreview={(i) => {
                const img = pendingImages[i];
                if (!img) {
                  return;
                }
                openImageViewer(
                  `data:${img.attachment.media_type};base64,${img.attachment.data}`,
                  img.name,
                  img.previewUrl,
                );
              }}
              onRemove={removeImage}
            />
            <div className={styles.promptChips}>
              {knownModels.length > 0 && modelDisplayName && (
                <div ref={modelChipRef} className={styles.chipAnchor}>
                  <Chip
                    mono
                    muted
                    interactive
                    title="Switch model for the first agent"
                    onClick={() => setModelPickerOpen((o) => !o)}
                  >
                    {modelDisplayName}
                  </Chip>
                  {modelPickerOpen && (
                    <ModelPicker
                      triggerRef={modelChipRef}
                      currentModel={modelValue}
                      models={knownModels}
                      runner={runnerSelection}
                      onClose={() => setModelPickerOpen(false)}
                      onSelect={(m) => {
                        setModelPickerOpen(false);
                        setModelValue(m);
                      }}
                    />
                  )}
                </div>
              )}
              <div ref={projectChipRef} className={styles.chipAnchor}>
                <Chip
                  interactive
                  muted={linkedProjects.length === 0}
                  aria-label="Link other project"
                  title={
                    linkedProjects.length === 0
                      ? "Link other project"
                      : `${linkedProjects.length} project${linkedProjects.length === 1 ? "" : "s"} linked`
                  }
                  leading={<Icons.FolderIcon size={11} />}
                  onClick={() => setProjectPickerOpen((o) => !o)}
                >
                  {linkedProjects.length === 0
                    ? "Link other project"
                    : `${linkedProjects.length} linked`}
                </Chip>
                {projectPickerOpen && (
                  <ProjectPicker
                    triggerRef={projectChipRef}
                    projects={allProjects}
                    selectedPaths={linkedProjects}
                    excludePaths={[repoRoot]}
                    onToggle={toggleLinkedProject}
                    onClose={() => setProjectPickerOpen(false)}
                  />
                )}
              </div>
            </div>
            <input
              ref={fileInputRef}
              accept={ACCEPTED_IMAGE_TYPES}
              className={styles.hiddenFileInput}
              multiple
              tabIndex={-1}
              type="file"
              onChange={handleFileSelect}
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
                  { label: "Origin", branches: sourceOriginRefs },
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
      size="medium"
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
