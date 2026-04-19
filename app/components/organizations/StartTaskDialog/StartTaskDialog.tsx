import { useMemo, useState } from "react";
import { Button, Dialog, Input, TextArea } from "@argus/peacock";
import {
  hideStartTaskDialog,
  useStartTaskDialogOrgId,
} from "../../../stores/dialogStore";
import { useOrganizations } from "../../../stores/organizationStore";
import { setActiveOrgTask, startOrgTask } from "../../../stores/orgTaskStore";
import styles from "./StartTaskDialog.module.css";

export function StartTaskDialogHost() {
  const orgId = useStartTaskDialogOrgId();
  if (!orgId) {
    return null;
  }

  return <StartTaskDialog key={orgId} orgId={orgId} />;
}

interface MemberRowState {
  addendum: string;
  expanded: boolean;
  repo_root: string;
  role: string;
  selected: boolean;
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

function StartTaskDialog({ orgId }: { orgId: string }) {
  const orgs = useOrganizations();
  const org = useMemo(() => orgs.find((o) => o.id === orgId), [orgs, orgId]);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [members, setMembers] = useState<MemberRowState[]>(() =>
    (org?.members ?? []).map((m) => ({
      repo_root: m.repo_root,
      role: m.role,
      selected: true,
      addendum: "",
      expanded: false,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!org) {
    return null;
  }

  const patchMember = (idx: number, patch: Partial<MemberRowState>) => {
    setMembers((ms) => ms.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");

      return;
    }
    if (!prompt.trim()) {
      setError("Prompt is required.");

      return;
    }
    const selected = members.filter((m) => m.selected);
    if (selected.length === 0) {
      setError("Select at least one member repo.");

      return;
    }

    setSaving(true);
    try {
      const task = await startOrgTask({
        organizationId: orgId,
        title: title.trim(),
        prompt: prompt.trim(),
        members: selected.map((m) => ({
          repo_root: m.repo_root,
          addendum: m.addendum.trim(),
        })),
      });
      setActiveOrgTask(task.id);
      hideStartTaskDialog();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      onClose={hideStartTaskDialog}
      title={`Start task — ${org.name}`}
      titleId="start-task-dialog"
      className={styles.dialog}
    >
      <div className={styles.body}>
        <Field label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add favorites list"
            autoFocus
          />
        </Field>

        <Field
          label="Prompt"
          hint="Shared with every selected member agent. Describe the feature and the expected end-state across the product."
        >
          <TextArea
            rows={7}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Add a favorites list feature: backend exposes /favorites endpoints, iOS app shows a Favorites tab, web admin can view user favorites."
          />
        </Field>

        <Field
          label="Members"
          hint="Each selected repo gets its own workspace + agent, all seeded with the shared prompt."
        >
          <div className={styles.members}>
            {members.length === 0 && (
              <div className={styles.memberRole}>
                This organization has no member repos yet.
              </div>
            )}
            {members.map((m, idx) => (
              <div key={m.repo_root} className={styles.memberRow}>
                <div className={styles.memberHead}>
                  <input
                    type="checkbox"
                    className={styles.memberCheckbox}
                    checked={m.selected}
                    onChange={(e) =>
                      patchMember(idx, { selected: e.target.checked })
                    }
                  />
                  <div className={styles.memberPath}>
                    <div className={styles.memberName}>
                      {basename(m.repo_root)}
                    </div>
                    <div className={styles.memberRole}>
                      {m.role || "(no role)"} · {m.repo_root}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.memberToggle}
                    onClick={() => patchMember(idx, { expanded: !m.expanded })}
                  >
                    {m.expanded ? "Hide addendum" : "Add addendum"}
                  </button>
                </div>
                {m.expanded && (
                  <TextArea
                    rows={3}
                    value={m.addendum}
                    onChange={(e) =>
                      patchMember(idx, { addendum: e.target.value })
                    }
                    placeholder={`Extra instructions specific to ${basename(m.repo_root)} (optional)`}
                  />
                )}
              </div>
            ))}
          </div>
        </Field>

        {error && <div className={styles.error}>{error}</div>}
      </div>

      <div className={styles.footer}>
        <div className={styles.footerSpacer} />
        <Button variant="ghost" onClick={hideStartTaskDialog} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={saving}>
          {saving ? "Starting…" : "Start"}
        </Button>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  );
}
