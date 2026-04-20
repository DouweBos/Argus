import { Button } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { OnboardingLayout } from "./OnboardingLayout";

export function FirstAgentStep() {
  const { advance } = useOnboarding();

  return (
    <OnboardingLayout
      currentStep="first_agent"
      title="Ready for your first agent"
      subtitle="Once you land in the main window, your workspace is pre-selected. Paste a prompt into the chat — Argus spawns the agent in plan mode for safety."
      footerLeft={
        <Button
          variant="ghost"
          onClick={() => {
            advance("completion").catch(() => {});
          }}
        >
          Skip
        </Button>
      }
      footerRight={
        <Button
          variant="primary"
          onClick={() => {
            advance("completion").catch(() => {});
          }}
        >
          Take me there
        </Button>
      }
    >
      <div
        style={{
          padding: "14px 16px",
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          borderRadius: "var(--border-radius-medium)",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          color: "var(--text-secondary)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--text-primary)" }}>
          Suggested first prompt:
        </strong>
        <br />
        “Add a <code>Hello from Argus</code> comment at the top of
        <code> README.md</code>.”
      </div>
    </OnboardingLayout>
  );
}
