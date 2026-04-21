import { useState } from "react";
import { Button, FormField, Input } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { runPrereqFixer, saveOnboardingDefaults } from "../../lib/ipc";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { OnboardingLayout } from "./OnboardingLayout";

const MODELS = [
  { value: "claude-opus-4-7", label: "Opus 4.7 (most capable)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (balanced)" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 (fastest)" },
];

const PERMISSION_MODES = [
  { value: "plan", label: "plan (safest — approve every edit)" },
  { value: "acceptEdits", label: "acceptEdits (auto-accept edits)" },
  { value: "auto", label: "auto (let the agent run)" },
];

export function DefaultsFormStep() {
  const { advance, config } = useOnboarding();
  const existingIdentity = useOnboardingStore(
    (s) => s.prereqs.git_identity?.message ?? "",
  );
  const [gitName, setGitName] = useState(() => {
    const m = existingIdentity.match(/^([^<]+) </);

    return m ? m[1].trim() : "";
  });
  const [gitEmail, setGitEmail] = useState(() => {
    const m = existingIdentity.match(/<([^>]+)>/);

    return m ? m[1].trim() : "";
  });
  const [model, setModel] = useState(
    config?.defaults.model ?? "claude-opus-4-7",
  );
  const [permissionMode, setPermissionMode] = useState(
    config?.defaults.permissionMode ?? "plan",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (gitName.trim() && gitEmail.trim()) {
        const r = await runPrereqFixer("git_identity", {
          gitName: gitName.trim(),
          gitEmail: gitEmail.trim(),
        });
        if (!r.ok) {
          throw new Error(r.error ?? "failed to save git identity");
        }
      }
      await saveOnboardingDefaults({ model, permissionMode });
      await advance("project");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="defaults"
      title="Defaults"
      subtitle="Confirm your git identity and pick default agent settings. You can change these per-agent later."
      footerRight={
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            submit().catch(() => {});
          }}
        >
          {busy ? "Saving…" : "Continue"}
        </Button>
      }
    >
      <FormField
        label="Git name"
        htmlFor="git-name"
        helper="Used as commit author inside worktrees."
      >
        <Input
          id="git-name"
          value={gitName}
          onChange={(e) => setGitName(e.target.value)}
          placeholder="Your name"
        />
      </FormField>
      <FormField label="Git email" htmlFor="git-email">
        <Input
          id="git-email"
          value={gitEmail}
          onChange={(e) => setGitEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </FormField>
      <FormField label="Default Claude model">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{
            padding: "8px 10px",
            borderRadius: "var(--border-radius-small)",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-ui)",
          }}
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Default permission mode">
        <select
          value={permissionMode}
          onChange={(e) => setPermissionMode(e.target.value)}
          style={{
            padding: "8px 10px",
            borderRadius: "var(--border-radius-small)",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-ui)",
          }}
        >
          {PERMISSION_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </FormField>
      {error ? (
        <div style={{ color: "var(--error)", fontSize: 12 }}>{error}</div>
      ) : null}
    </OnboardingLayout>
  );
}
