import type { RunnerDraft } from "./customRunnerDraft";
import type { RegisteredRunner } from "../../../lib/types";
import { useState } from "react";
import { Button, Icons, Input, Select } from "@argus/peacock";
import styles from "./CustomRunnersSection.module.css";

/** Values that look like credentials are masked until the user reveals them. */
function isSecretKey(key: string): boolean {
  return /token|key|secret|password/i.test(key);
}

interface CustomRunnerCardProps {
  /** Official runners this one may derive from. */
  baseRunners: RegisteredRunner[];
  draft: RunnerDraft;
  error: string | null;
  onChange: (next: RunnerDraft) => void;
  onDelete: () => void;
  onSave: () => void;
  saving: boolean;
}

export function CustomRunnerCard({
  draft,
  baseRunners,
  onChange,
  onSave,
  onDelete,
  saving,
  error,
}: CustomRunnerCardProps) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const patch = (next: Partial<RunnerDraft>) => onChange({ ...draft, ...next });

  const toggleReveal = (index: number) => {
    const next = new Set(revealed);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setRevealed(next);
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>
          <strong>{draft.displayName || "New runner"}</strong>
          {draft.id && <span className={styles.cardId}>{draft.id}</span>}
        </span>
        <Button
          aria-label="Remove runner"
          leading={<Icons.CloseIcon size={12} />}
          variant="ghost"
          onClick={onDelete}
        >
          Remove
        </Button>
      </div>

      <div className={styles.grid}>
        <span className={styles.label}>Name</span>
        <Input
          placeholder="e.g. Apex"
          value={draft.displayName}
          onChange={(e) => patch({ displayName: e.target.value })}
        />

        <span className={styles.label}>Based on</span>
        <Select
          value={draft.baseRunnerId}
          onChange={(e) => patch({ baseRunnerId: e.target.value })}
        >
          {baseRunners.map((r) => (
            <option key={r.id} value={r.id}>
              {r.displayName}
            </option>
          ))}
        </Select>

        <span className={styles.label}>Default model</span>
        <Input
          mono
          placeholder="e.g. callstack/Apex"
          value={draft.defaultModel ?? ""}
          onChange={(e) => patch({ defaultModel: e.target.value || null })}
        />
      </div>

      <div className={styles.subhead}>
        <span>Environment</span>
        <Button
          leading={<Icons.PlusIcon size={11} />}
          size="sm"
          variant="ghost"
          onClick={() =>
            patch({ envRows: [...draft.envRows, { key: "", value: "" }] })
          }
        >
          Add variable
        </Button>
      </div>
      <div className={styles.rows}>
        {draft.envRows.map((row, i) => (
          <div key={i} className={styles.row}>
            <Input
              mono
              placeholder="ANTHROPIC_BASE_URL"
              value={row.key}
              onChange={(e) =>
                patch({
                  envRows: draft.envRows.map((r, j) =>
                    j === i ? { ...r, key: e.target.value } : r,
                  ),
                })
              }
            />
            <Input
              mono
              placeholder="value"
              type={
                isSecretKey(row.key) && !revealed.has(i) ? "password" : "text"
              }
              value={row.value}
              onChange={(e) =>
                patch({
                  envRows: draft.envRows.map((r, j) =>
                    j === i ? { ...r, value: e.target.value } : r,
                  ),
                })
              }
            />
            {isSecretKey(row.key) && (
              <Button size="sm" variant="ghost" onClick={() => toggleReveal(i)}>
                {revealed.has(i) ? "Hide" : "Show"}
              </Button>
            )}
            <Button
              aria-label="Remove variable"
              size="sm"
              variant="ghost"
              onClick={() =>
                patch({ envRows: draft.envRows.filter((_, j) => j !== i) })
              }
            >
              <Icons.CloseIcon size={11} />
            </Button>
          </div>
        ))}
      </div>

      <div className={styles.subhead}>
        <span>Models</span>
        <Button
          leading={<Icons.PlusIcon size={11} />}
          size="sm"
          variant="ghost"
          onClick={() =>
            patch({
              models: [...draft.models, { id: "", displayName: "" }],
            })
          }
        >
          Add model
        </Button>
      </div>
      <div className={styles.rows}>
        {draft.models.map((model, i) => (
          <div key={i} className={styles.row}>
            <Input
              mono
              placeholder="callstack/Apex"
              value={model.id}
              onChange={(e) =>
                patch({
                  models: draft.models.map((m, j) =>
                    j === i ? { ...m, id: e.target.value } : m,
                  ),
                })
              }
            />
            <Input
              placeholder="Label shown in the picker"
              value={model.displayName}
              onChange={(e) =>
                patch({
                  models: draft.models.map((m, j) =>
                    j === i ? { ...m, displayName: e.target.value } : m,
                  ),
                })
              }
            />
            <Button
              aria-label="Remove model"
              size="sm"
              variant="ghost"
              onClick={() =>
                patch({ models: draft.models.filter((_, j) => j !== i) })
              }
            >
              <Icons.CloseIcon size={11} />
            </Button>
          </div>
        ))}
        {draft.models.length === 0 && (
          <p className={styles.hint}>
            No models listed — the picker falls back to whatever the base runner
            advertises.
          </p>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <Button
          disabled={saving || !draft.displayName.trim()}
          variant="primary"
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
