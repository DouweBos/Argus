import { useEffect, useState } from "react";
import { Button, ForkChatDialog, Input } from "@argus/peacock";
import {
  forkChatFromMessage,
  forkChatIntoNewAgent,
} from "../../../lib/forkChat";
import {
  getUserProjectSettings,
  listAllBranches,
  setUserProjectSettings,
} from "../../../lib/ipc";
import { dialogStyles as styles } from "../../shared/Dialog";

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
  const [branches, setBranches] = useState<Set<string>>(new Set());
  const [branchPrefix, setBranchPrefix] = useState("");
  const [prefixDraft, setPrefixDraft] = useState("");
  const [editingPrefix, setEditingPrefix] = useState(false);
  const [prefixError, setPrefixError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserProjectSettings(repoRoot)
      .then((s) => {
        if (!cancelled) {
          setBranchPrefix(s.branch_prefix ?? "");
          setPrefixDraft(s.branch_prefix ?? "");
        }
      })
      .catch(() => {});
    listAllBranches(repoRoot)
      .then((list) => {
        if (!cancelled) {
          setBranches(new Set([...list.local, ...list.remote]));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  const savePrefix = async () => {
    try {
      const saved = await setUserProjectSettings(repoRoot, {
        branch_prefix: prefixDraft.trim(),
      });
      setBranchPrefix(saved.branch_prefix ?? "");
      setPrefixDraft(saved.branch_prefix ?? "");
      setEditingPrefix(false);
      setPrefixError(null);
    } catch (e) {
      setPrefixError(e instanceof Error ? e.message : "Failed to save prefix");
    }
  };

  const prefixRow = (
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
            type="button"
            variant="secondary"
            onClick={() => {
              setPrefixDraft(branchPrefix);
              setEditingPrefix(false);
            }}
          >
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={savePrefix}>
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
      {prefixError && <span className={styles.errorMsg}>{prefixError}</span>}
    </div>
  );

  return (
    <ForkChatDialog
      branchFooter={prefixRow}
      describeBranch={(branch, description) => {
        const slug = branch
          ? previewSlug(applyBranchPrefix(branch, branchPrefix))
          : "";
        if (slug && branches.has(slug)) {
          return { hint: `Branch "${slug}" already exists.`, blocked: true };
        }
        if (slug) {
          return {
            hint: (
              <>
                New branch: <strong>{slug}</strong>
              </>
            ),
          };
        }

        return description
          ? { hint: "Branch name will be generated from your description." }
          : null;
      }}
      onClose={onClose}
      onSubmit={async ({ into, description, branch }) => {
        if (into === "agent") {
          await forkChatIntoNewAgent(sourceSessionId, agentId, messageId);
        } else {
          await forkChatFromMessage(
            sourceSessionId,
            agentId,
            messageId,
            branch ? applyBranchPrefix(branch, branchPrefix) : "",
            description,
          );
        }
      }}
    />
  );
}
