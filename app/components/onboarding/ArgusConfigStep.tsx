import { useEffect, useState } from "react";
import { Button, CodeBlock } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import {
  readExistingArgusJson,
  suggestArgusJson,
  writeOnboardingArgusJson,
} from "../../lib/ipc";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { OnboardingLayout } from "./OnboardingLayout";

export function ArgusConfigStep() {
  const { advance } = useOnboarding();
  const projectPath = useOnboardingStore((s) => s.projectPath);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [inferredFrom, setInferredFrom] = useState<string[]>([]);
  const [existing, setExisting] = useState<Record<string, unknown> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      return;
    }
    (async () => {
      try {
        const [existingConfig, suggestion] = await Promise.all([
          readExistingArgusJson(projectPath),
          suggestArgusJson(projectPath),
        ]);
        setExisting(existingConfig);
        setConfig(existingConfig ?? suggestion.config);
        setInferredFrom(suggestion.inferredFrom);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })().catch(() => {});
  }, [projectPath]);

  const save = async () => {
    if (!projectPath || !config) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await writeOnboardingArgusJson(projectPath, config);
      await advance("first_workspace");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    await advance("first_workspace");
  };

  const configJson = config ? JSON.stringify(config, null, 2) : "";

  let footerRight = "Write .argus.json";
  if (busy) {
    footerRight = "Saving…";
  } else if (existing) {
    footerRight = "Keep as-is";
  }

  return (
    <OnboardingLayout
      currentStep="argus_config"
      title={existing ? "Review .argus.json" : "Generate .argus.json"}
      subtitle={
        existing
          ? "This project already has an Argus config. Review it; regenerating will back up the current file to .argus.json.bak."
          : "Argus infers project settings from package.json and common lockfiles. Review and confirm — you can hand-edit later."
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
          disabled={busy || !config}
          onClick={() => {
            save().catch(() => {});
          }}
        >
          {footerRight}
        </Button>
      }
    >
      {inferredFrom.length > 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Inferred from: {inferredFrom.join(", ")}
        </div>
      ) : null}
      {configJson ? <CodeBlock code={configJson} language="json" /> : null}
      {error ? (
        <div style={{ color: "var(--error)", fontSize: 12 }}>{error}</div>
      ) : null}
    </OnboardingLayout>
  );
}
