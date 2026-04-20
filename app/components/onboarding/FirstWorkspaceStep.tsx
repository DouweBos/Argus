import { useState } from "react";
import { Button, FormField, Input } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { addRepoRoot, createWorkspace } from "../../lib/ipc";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { OnboardingLayout } from "./OnboardingLayout";

export function FirstWorkspaceStep() {
  const { advance } = useOnboarding();
  const projectPath = useOnboardingStore((s) => s.projectPath);
  const [branch, setBranch] = useState("argus/try-me");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!projectPath) {
      setError("No project selected");

      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addRepoRoot(projectPath);
      await createWorkspace(
        projectPath,
        branch,
        "Onboarding trial workspace",
        false,
      );
      await advance("first_agent");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="first_workspace"
      title="Create your first workspace"
      subtitle="Argus will add the project to the sidebar and run the setup pipeline in an isolated git worktree."
      footerLeft={
        <Button
          variant="ghost"
          onClick={() => {
            advance("first_agent").catch(() => {});
          }}
        >
          Skip
        </Button>
      }
      footerRight={
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            create().catch(() => {});
          }}
        >
          {busy ? "Creating…" : "Create workspace"}
        </Button>
      }
    >
      <FormField
        label="Branch name"
        helper="We'll create this branch and its worktree."
      >
        <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
      </FormField>
      {error ? (
        <div style={{ color: "var(--error)", fontSize: 12 }}>{error}</div>
      ) : null}
    </OnboardingLayout>
  );
}
