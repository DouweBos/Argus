import type { OrganizationMember } from "../../../lib/types";
import { useMemo, useState } from "react";
import { Button, Dialog, Icons, Input, TextArea } from "@argus/peacock";
import {
  hideOrganizationDialog,
  useOrganizationDialog,
} from "../../../stores/dialogStore";
import {
  createOrganization,
  deleteOrganization,
  updateOrganization,
  useOrganizations,
} from "../../../stores/organizationStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import styles from "./OrganizationDialog.module.css";

export function OrganizationDialogHost() {
  const state = useOrganizationDialog();
  if (!state) {
    return null;
  }

  return (
    <OrganizationDialog
      key={state.mode === "edit" ? state.id : "create"}
      orgId={state.mode === "edit" ? state.id : null}
    />
  );
}

interface FormState {
  accent: string;
  description: string;
  members: OrganizationMember[];
  name: string;
  systemPrompt: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  systemPrompt: "",
  accent: "#7c5cfc",
  members: [],
};

function OrganizationDialog({ orgId }: { orgId: string | null }) {
  const orgs = useOrganizations();
  const recents = useRecentProjects();
  const existing = orgId ? orgs.find((o) => o.id === orgId) : null;

  const [form, setForm] = useState<FormState>(() =>
    existing
      ? {
          name: existing.name,
          description: existing.description,
          systemPrompt: existing.system_prompt,
          accent: existing.accent,
          members: existing.members,
        }
      : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const updateMember = (idx: number, patch: Partial<OrganizationMember>) => {
    setForm((f) => ({
      ...f,
      members: f.members.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    }));
  };

  const addMember = (repoRoot: string) => {
    if (!repoRoot) {
      return;
    }
    setForm((f) =>
      f.members.some((m) => m.repo_root === repoRoot)
        ? f
        : { ...f, members: [...f.members, { repo_root: repoRoot, role: "" }] },
    );
  };

  const removeMember = (idx: number) => {
    setForm((f) => ({
      ...f,
      members: f.members.filter((_, i) => i !== idx),
    }));
  };

  const recentOptions = useMemo(() => {
    const already = new Set(form.members.map((m) => m.repo_root));

    return recents.filter((r) => !already.has(r.path));
  }, [recents, form.members]);

  const handleSubmit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError("Name is required.");

      return;
    }
    setSaving(true);
    try {
      if (existing) {
        await updateOrganization({
          id: existing.id,
          name: form.name,
          description: form.description,
          systemPrompt: form.systemPrompt,
          accent: form.accent,
          members: form.members,
        });
      } else {
        await createOrganization({
          name: form.name,
          description: form.description,
          systemPrompt: form.systemPrompt,
          accent: form.accent,
          members: form.members,
        });
      }
      hideOrganizationDialog();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existing) {
      return;
    }
    if (!window.confirm(`Delete organization "${existing.name}"?`)) {
      return;
    }
    setSaving(true);
    try {
      await deleteOrganization(existing.id);
      hideOrganizationDialog();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      onClose={hideOrganizationDialog}
      title={existing ? "Edit organization" : "New organization"}
      titleId="organization-dialog"
      className={styles.dialog}
    >
      <div className={styles.body}>
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Shopster"
            autoFocus
          />
        </Field>

        <Field label="Description">
          <Input
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="The Shopster mobile commerce product"
          />
        </Field>

        <Field
          label="System prompt"
          hint="Injected into every agent spawned in a member repo. Describe the product and how the repos fit together."
        >
          <TextArea
            rows={6}
            value={form.systemPrompt}
            onChange={(e) => update("systemPrompt", e.target.value)}
            placeholder="Shopster is a mobile-first commerce app. The backend exposes a GraphQL API consumed by the iOS app and a small admin web dashboard. When implementing a feature, coordinate schema changes in the backend first, then implement clients in each app."
          />
        </Field>

        <Field label="Accent color">
          <input
            type="color"
            value={form.accent}
            onChange={(e) => update("accent", e.target.value)}
            className={styles.colorInput}
          />
        </Field>

        <Field
          label="Member repos"
          hint="Each member describes which slice of the product that repo implements."
        >
          <div className={styles.members}>
            {form.members.length === 0 && (
              <div className={styles.emptyMembers}>
                No repos yet. Add one below.
              </div>
            )}
            {form.members.map((m, idx) => (
              <div key={m.repo_root} className={styles.memberRow}>
                <div className={styles.memberPath} title={m.repo_root}>
                  {m.repo_root}
                </div>
                <Input
                  className={styles.memberRole}
                  value={m.role}
                  onChange={(e) => updateMember(idx, { role: e.target.value })}
                  placeholder="Role (e.g. Backend API)"
                />
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => removeMember(idx)}
                  aria-label="Remove member"
                >
                  <Icons.TrashIcon size={12} />
                </button>
              </div>
            ))}

            {recentOptions.length > 0 && (
              <div className={styles.addRow}>
                <select
                  className={styles.select}
                  defaultValue=""
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) {
                      addMember(value);
                      e.currentTarget.value = "";
                    }
                  }}
                >
                  <option value="">Add repo from recent projects…</option>
                  {recentOptions.map((r) => (
                    <option key={r.path} value={r.path}>
                      {r.name} — {r.path}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <ManualAddRow onAdd={addMember} />
          </div>
        </Field>

        {error && <div className={styles.error}>{error}</div>}
      </div>

      <div className={styles.footer}>
        {existing && (
          <Button
            variant="ghost"
            onClick={handleDelete}
            disabled={saving}
            leading={<Icons.TrashIcon size={11} />}
          >
            Delete
          </Button>
        )}
        <div className={styles.footerSpacer} />
        <Button
          variant="ghost"
          onClick={hideOrganizationDialog}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={saving}>
          {existing ? "Save" : "Create"}
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

function ManualAddRow({ onAdd }: { onAdd: (path: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className={styles.addRow}>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="/absolute/path/to/repo"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (value.trim()) {
              onAdd(value.trim());
              setValue("");
            }
          }
        }}
      />
      <Button
        variant="ghost"
        onClick={() => {
          if (value.trim()) {
            onAdd(value.trim());
            setValue("");
          }
        }}
      >
        Add
      </Button>
    </div>
  );
}
