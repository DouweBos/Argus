import { useEffect, useId, useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { Input } from "../Input/Input";
import styles from "./PushDialog.module.css";

export type PushTagsMode = "all" | "follow" | "none";

export interface PushDialogResult {
  branch: string;
  remote: string;
  setUpstream: boolean;
  forceWithLease: boolean;
  tags: PushTagsMode;
  ref?: string;
}

export interface PushDialogProps {
  open: boolean;
  /** Current branch — pre-filled into the branch field. */
  currentBranch: string;
  /** Optional list of remote names; defaults to `["origin"]`. */
  remotes?: string[];
  /** Whether the current branch already has an upstream configured. */
  hasUpstream?: boolean;
  /** Whether the dialog is in the secondary "force-with-lease confirm" stage. */
  forceConfirmStage?: boolean;
  defaultTags?: PushTagsMode;
  onConfirm: (result: PushDialogResult) => void;
  onCancel: () => void;
}

export function PushDialog({
  open,
  currentBranch,
  remotes,
  hasUpstream = true,
  forceConfirmStage = false,
  defaultTags = "follow",
  onConfirm,
  onCancel,
}: PushDialogProps) {
  const titleId = useId();
  const branchId = useId();
  const remoteId = useId();
  const upstreamId = useId();
  const forceId = useId();
  const tagsId = useId();
  const refId = useId();

  const remoteList = remotes && remotes.length > 0 ? remotes : ["origin"];

  const [branch, setBranch] = useState(currentBranch);
  const [remote, setRemote] = useState(remoteList[0] ?? "origin");
  const [setUpstream, setSetUpstream] = useState(!hasUpstream);
  const [forceWithLease, setForceWithLease] = useState(false);
  const [tags, setTags] = useState<PushTagsMode>(defaultTags);
  const [ref, setRef] = useState("");
  const [confirmingForce, setConfirmingForce] = useState(forceConfirmStage);

  useEffect(() => {
    if (open) {
      setBranch(currentBranch);
      setRemote(remoteList[0] ?? "origin");
      setSetUpstream(!hasUpstream);
      setForceWithLease(false);
      setTags(defaultTags);
      setRef("");
      setConfirmingForce(forceConfirmStage);
    }
  }, [
    open,
    currentBranch,
    defaultTags,
    forceConfirmStage,
    hasUpstream,
    remotes,
  ]);

  if (!open) {
    return null;
  }

  const submit = () => {
    if (forceWithLease && !confirmingForce) {
      setConfirmingForce(true);

      return;
    }
    const result: PushDialogResult = {
      branch: branch.trim(),
      remote,
      setUpstream,
      forceWithLease,
      tags,
    };
    if (ref.trim().length > 0) {
      result.ref = ref.trim();
    }
    onConfirm(result);
  };

  const title = confirmingForce ? "Confirm force push" : "Push";
  let confirmLabel: string;
  if (confirmingForce) {
    confirmLabel = "Force push (with lease)";
  } else if (forceWithLease) {
    confirmLabel = "Continue…";
  } else {
    confirmLabel = "Push";
  }

  return (
    <Dialog onClose={onCancel} title={title} titleId={titleId}>
      <div className={styles.body}>
        {confirmingForce ? (
          <div className={styles.warning}>
            Force-with-lease will rewrite the remote branch. The push aborts if
            anyone else has pushed since your last fetch.
          </div>
        ) : (
          <>
            <label className={styles.fieldLabel} htmlFor={branchId}>
              Branch
            </label>
            <Input
              id={branchId}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />

            <label className={styles.fieldLabel} htmlFor={remoteId}>
              Remote
            </label>
            <select
              id={remoteId}
              className={styles.select}
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
            >
              {remoteList.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <label className={styles.checkRow} htmlFor={upstreamId}>
              <input
                id={upstreamId}
                type="checkbox"
                className={styles.checkbox}
                checked={setUpstream}
                onChange={(e) => setSetUpstream(e.target.checked)}
                disabled={hasUpstream}
              />
              <span>
                Set upstream
                {hasUpstream ? " (already set)" : ""}
              </span>
            </label>

            <label className={styles.checkRow} htmlFor={forceId}>
              <input
                id={forceId}
                type="checkbox"
                className={styles.checkbox}
                checked={forceWithLease}
                onChange={(e) => setForceWithLease(e.target.checked)}
              />
              <span>Force-with-lease</span>
            </label>

            <label className={styles.fieldLabel} htmlFor={tagsId}>
              Tags
            </label>
            <select
              id={tagsId}
              className={styles.select}
              value={tags}
              onChange={(e) => setTags(e.target.value as PushTagsMode)}
            >
              <option value="follow">Follow tags reachable from commits</option>
              <option value="all">All tags</option>
              <option value="none">No tags</option>
            </select>

            <details className={styles.advanced}>
              <summary className={styles.summary}>Advanced</summary>
              <label className={styles.fieldLabel} htmlFor={refId}>
                Specific ref override
              </label>
              <Input
                id={refId}
                placeholder="refs/heads/foo:refs/heads/bar"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            </details>
          </>
        )}
      </div>
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={forceWithLease || confirmingForce ? "danger" : "primary"}
          onClick={submit}
          disabled={!branch.trim()}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
