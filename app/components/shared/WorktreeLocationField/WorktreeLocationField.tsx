import type { WorktreeLocationProbe } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  Input,
  SettingsScreenField,
} from "@argus/peacock";
import { probeWorktreeLocation } from "../../../lib/ipc";
import { HostDirectoryPicker } from "../HostDirectoryPicker";
import styles from "./WorktreeLocationField.module.css";

interface WorktreeLocationFieldProps {
  /** Shown as the placeholder — what the location resolves to when unset. */
  defaultPath: string;
  hostLabel?: string;
  onCommit: (next: string) => Promise<void>;
  /** Repo this is for, when the field is editing a single project. */
  repoRoot?: string;
  /** The saved value. Empty means "inherit". */
  value: string;
}

/**
 * Picks the base directory worktrees are created in.
 *
 * Shared by the app-wide setting and the per-project override so the warnings
 * — especially the one about removable drives — are written once.
 */
export function WorktreeLocationField({
  defaultPath,
  hostLabel = "this Mac",
  repoRoot,
  value,
  onCommit,
}: WorktreeLocationFieldProps) {
  const [draft, setDraft] = useState(value);
  const [probe, setProbe] = useState<WorktreeLocationProbe | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const trimmed = draft.trim();
  const dirty = trimmed !== value.trim();

  useEffect(() => {
    if (!trimmed) {
      setProbe(null);

      return;
    }
    // Debounced: this stats the filesystem on every keystroke otherwise.
    const timer = setTimeout(() => {
      probeWorktreeLocation({ baseDir: trimmed, repoRoot })
        .then(setProbe)
        .catch(() => setProbe(null));
    }, 300);

    return () => clearTimeout(timer);
  }, [trimmed, repoRoot]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await onCommit(trimmed);
    } finally {
      setSaving(false);
    }
  }, [onCommit, trimmed]);

  const blocked = probe?.reason != null;

  return (
    <SettingsScreenField
      label="Worktree location"
      caption={`Argus creates <this folder>/<Repo>-argus-worktrees/ underneath. Leave it empty to use ${defaultPath}.`}
    >
      <div className={styles.row}>
        <Input
          className={styles.input}
          placeholder={defaultPath}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button variant="ghost" onClick={() => setBrowsing(true)}>
          Browse…
        </Button>
        {trimmed !== "" && (
          <Button variant="ghost" onClick={() => setDraft("")}>
            Use default
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!dirty || blocked || saving}
          onClick={() => {
            save().catch(() => undefined);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {probe?.reason != null && <Banner tone="error">{probe.reason}</Banner>}
      {probe?.reason == null && probe?.removable === true && (
        <Banner tone="warning">
          {probe.volume_label} is a removable drive. When it isn&apos;t
          connected, this project&apos;s sessions stay in the sidebar but
          can&apos;t be opened.
        </Banner>
      )}
      {probe?.reason == null && trimmed !== "" && probe?.exists === false && (
        <Banner tone="info">
          That folder doesn&apos;t exist yet — Argus creates it with the first
          session.
        </Banner>
      )}

      {browsing && (
        <Dialog
          title="Choose a worktree location"
          titleId="worktree-location-picker"
          size="medium"
          onClose={() => setBrowsing(false)}
        >
          <DialogBody>
            <HostDirectoryPicker
              confirmLabel="Use this folder"
              hostLabel={hostLabel}
              onCancel={() => setBrowsing(false)}
              onPick={(path) => {
                setDraft(path);
                setBrowsing(false);
              }}
            />
          </DialogBody>
        </Dialog>
      )}
    </SettingsScreenField>
  );
}
