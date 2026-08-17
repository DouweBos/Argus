import type { CustomRunnerPreset } from "../../../lib/types";
import { useEffect, useState } from "react";
import {
  Button,
  Icons,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
} from "@argus/peacock";
import {
  deleteCustomRunner,
  listCustomRunnerPresets,
  listCustomRunners,
  saveCustomRunner,
} from "../../../lib/ipc";
import {
  reloadRegisteredRunners,
  useRegisteredRunners,
} from "../../../stores/runnersStore";
import { CustomRunnerCard } from "./CustomRunnerCard";
import styles from "./CustomRunnersSection.module.css";
import { fromDraft, toDraft, type RunnerDraft } from "./customRunnerDraft";

/**
 * Custom runners: an official runner (Claude Code) re-pointed at another
 * Anthropic-compatible endpoint via environment overrides. Drafts stay
 * local until saved so a half-typed API token never hits disk.
 */
export function CustomRunnersSection() {
  const registered = useRegisteredRunners();
  const baseRunners = registered.filter((r) => !r.isCustom);
  const [drafts, setDrafts] = useState<RunnerDraft[]>([]);
  const [presets, setPresets] = useState<CustomRunnerPreset[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    listCustomRunners()
      .then((runners) => setDrafts(runners.map(toDraft)))
      .catch(() => setDrafts([]));
    listCustomRunnerPresets()
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

  const draftKey = (draft: RunnerDraft, index: number) =>
    draft.id ?? `new-${index}`;

  const addFromPreset = (preset: CustomRunnerPreset) =>
    setDrafts((prev) => [...prev, toDraft({ ...preset.draft })]);

  const save = async (index: number) => {
    const draft = drafts[index];
    if (!draft) {
      return;
    }
    const key = draftKey(draft, index);
    setSavingId(key);
    setErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      const saved = await saveCustomRunner(fromDraft(draft));
      setDrafts((prev) =>
        prev.map((d, i) => (i === index ? toDraft(saved) : d)),
      );
      await reloadRegisteredRunners();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (index: number) => {
    const draft = drafts[index];
    setDrafts((prev) => prev.filter((_, i) => i !== index));
    if (!draft?.id) {
      return;
    }
    await deleteCustomRunner(draft.id);
    await reloadRegisteredRunners();
  };

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description={
          <>
            Point an official runner at a different endpoint — a gateway like
            callstack.ai&apos;s Apex, a proxy, or a self-hosted model. Custom
            runners reuse the base runner&apos;s CLI and only override its
            environment and model list. Stored in{" "}
            <code>~/.argus/custom-runners.json</code>; pick one per session in
            the runner picker or as the app default under LLM.
          </>
        }
        title="Custom runners"
      />
      <SettingsScreenDetailBody>
        <div className={styles.presets}>
          {presets.map((preset) => (
            <Button
              key={preset.key}
              leading={<Icons.PlusIcon size={11} />}
              size="sm"
              title={preset.description}
              variant="secondary"
              onClick={() => addFromPreset(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className={styles.list}>
          {drafts.map((draft, index) => (
            <CustomRunnerCard
              key={draftKey(draft, index)}
              baseRunners={baseRunners}
              draft={draft}
              error={errors[draftKey(draft, index)] || null}
              saving={savingId === draftKey(draft, index)}
              onChange={(next) =>
                setDrafts((prev) =>
                  prev.map((d, i) => (i === index ? next : d)),
                )
              }
              onDelete={() => {
                remove(index).catch(() => undefined);
              }}
              onSave={() => {
                save(index).catch(() => undefined);
              }}
            />
          ))}
          {drafts.length === 0 && (
            <p className={styles.hint}>
              No custom runners yet. Start from a template above.
            </p>
          )}
        </div>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
