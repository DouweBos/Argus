import type { OrganizationMember } from "../../../lib/types";
import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  Icons,
  Input,
  PROJECT_ACCENT_PALETTE,
  TextArea,
} from "@argus/peacock";
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
  accent: PROJECT_ACCENT_PALETTE[1],
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
      size="medium"
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
          <div className={styles.swatches} role="radiogroup">
            {PROJECT_ACCENT_PALETTE.map((color) => {
              const selected = form.accent === color;

              return (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Accent ${color}`}
                  className={`${styles.swatch} ${selected ? styles.swatchSelected : ""}`}
                  style={{ background: color }}
                  onClick={() => update("accent", color)}
                />
              );
            })}
          </div>
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
              <div className={styles.recentsGroup}>
                <span className={styles.recentsLabel}>
                  Add from recent projects
                </span>
                <div className={styles.pills}>
                  {recentOptions.map((r) => (
                    <button
                      key={r.path}
                      type="button"
                      className={styles.pill}
                      title={r.path}
                      onClick={() => addMember(r.path)}
                    >
                      <Icons.PlusIcon size={10} />
                      <span className={styles.pillName}>{r.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <BrowseAddRow onAdd={addMember} />
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
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

function BrowseAddRow({ onAdd }: { onAdd: (path: string) => void }) {
  const handleBrowse = async () => {
    try {
      const selected = await window.argus.invoke<string | null>(
        "show_open_dialog",
      );
      if (selected && typeof selected === "string") {
        onAdd(selected);
      }
    } catch {
      // Dialog cancelled or failed — no-op
    }
  };

  return (
    <Button
      variant="ghost"
      className={styles.browseBtn}
      leading={<Icons.FolderIcon size={12} />}
      onClick={handleBrowse}
    >
      Browse for repo…
    </Button>
  );
}
