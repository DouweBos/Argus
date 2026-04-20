import { useEffect, useMemo, useState } from "react";
import { Button, Chip, TextArea } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import {
  readExistingArgusJson,
  refineArgusJsonWithClaude,
  suggestArgusJson,
  writeOnboardingArgusJson,
} from "../../lib/ipc";
import type { DetectedSignal } from "../../lib/types";
import { useOnboardingStore } from "../../stores/onboardingStore";
import styles from "./ArgusConfigStep.module.css";
import { OnboardingLayout } from "./OnboardingLayout";

export function ArgusConfigStep() {
  const { advance } = useOnboarding();
  const projectPath = useOnboardingStore((s) => s.projectPath);
  const [editor, setEditor] = useState<string>("");
  const [signals, setSignals] = useState<DetectedSignal[]>([]);
  const [inferredFrom, setInferredFrom] = useState<string[]>([]);
  const [existing, setExisting] = useState<Record<string, unknown> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectPath) {
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const [existingConfig, suggestion] = await Promise.all([
          readExistingArgusJson(projectPath),
          suggestArgusJson(projectPath),
        ]);
        setExisting(existingConfig);
        setEditor(
          JSON.stringify(existingConfig ?? suggestion.config, null, 2),
        );
        setInferredFrom(suggestion.inferredFrom);
        setSignals(suggestion.signals);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })().catch(() => {});
  }, [projectPath]);

  const parsed = useMemo(() => {
    try {
      const obj = JSON.parse(editor) as Record<string, unknown>;

      return { obj, error: null as string | null };
    } catch (e) {
      return {
        obj: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [editor]);

  const save = async () => {
    if (!projectPath || !parsed.obj) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await writeOnboardingArgusJson(projectPath, parsed.obj);
      await advance("first_session");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!projectPath) {
      return;
    }
    setError(null);
    try {
      const suggestion = await suggestArgusJson(projectPath);
      setEditor(JSON.stringify(suggestion.config, null, 2));
      setInferredFrom(suggestion.inferredFrom);
      setSignals(suggestion.signals);
      setExisting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const refine = async () => {
    if (!projectPath || !parsed.obj) {
      return;
    }
    setRefining(true);
    setError(null);
    try {
      const refined = await refineArgusJsonWithClaude(projectPath, parsed.obj);
      setEditor(JSON.stringify(refined, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefining(false);
    }
  };

  const skip = async () => {
    await advance("first_session");
  };

  let primaryLabel = "Write .argus.json";
  if (busy) {
    primaryLabel = "Saving…";
  } else if (existing) {
    primaryLabel = "Keep as-is";
  }

  return (
    <OnboardingLayout
      currentStep="argus_config"
      title={existing ? "Review .argus.json" : "Generate .argus.json"}
      subtitle={
        existing
          ? "This project already has an Argus config. Review and edit; saving will back up the current file to .argus.json.bak."
          : "Argus inspected your project and drafted a config. Review, hand-edit, or ask Claude to refine it — then save."
      }
      footerLeft={
        <Button
          variant="ghost"
          onClick={() => {
            skip().catch(() => {});
          }}
        >
          Skip for now
        </Button>
      }
      footerRight={
        <Button
          variant="primary"
          disabled={busy || !parsed.obj}
          onClick={() => {
            save().catch(() => {});
          }}
        >
          {primaryLabel}
        </Button>
      }
    >
      {loading ? (
        <div className={styles.muted}>Inspecting project…</div>
      ) : null}

      {signals.length > 0 ? (
        <div className={styles.signalsRow}>
          {signals.map((s, i) => (
            <Chip
              key={`${s.label}-${i}`}
              muted
              title={s.detail ? `${s.label} — ${s.detail}` : s.label}
            >
              <span className={styles.signalKind}>{s.kind}</span>
              {s.label}
            </Chip>
          ))}
        </div>
      ) : null}

      {inferredFrom.length > 0 ? (
        <div className={styles.muted}>
          Inferred from: {inferredFrom.join(", ")}
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <Button
          variant="secondary"
          disabled={refining || busy}
          onClick={() => {
            refine().catch(() => {});
          }}
        >
          {refining ? "Refining with Claude…" : "Refine with Claude"}
        </Button>
        <Button
          variant="ghost"
          disabled={refining || busy}
          onClick={() => {
            regenerate().catch(() => {});
          }}
        >
          Regenerate from project
        </Button>
      </div>

      <TextArea
        mono
        spellCheck={false}
        rows={18}
        value={editor}
        onChange={(e) => setEditor(e.target.value)}
        aria-label=".argus.json editor"
      />

      {parsed.error ? (
        <div className={styles.error}>Invalid JSON: {parsed.error}</div>
      ) : null}
      {error ? <div className={styles.error}>{error}</div> : null}
    </OnboardingLayout>
  );
}
