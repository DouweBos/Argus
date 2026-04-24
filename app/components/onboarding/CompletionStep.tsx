import { Button, EmptyStateIllustration } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { OnboardingLayout } from "./OnboardingLayout";

export function CompletionStep() {
  const { complete } = useOnboarding();

  return (
    <OnboardingLayout
      currentStep="completion"
      hero={<EmptyStateIllustration variant="success" size={120} />}
      title="You're all set"
      subtitle="Argus will mount the main window now. Add your first project from the sidebar — Argus will guide you through the rest as you go."
      footerRight={
        <Button
          variant="primary"
          onClick={() => {
            complete().catch(() => {});
          }}
        >
          Open Argus
        </Button>
      }
    >
      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: 0,
          margin: 0,
          listStyle: "none",
          fontFamily: "var(--font-ui)",
          color: "var(--text-secondary)",
          fontSize: 13,
        }}
      >
        <li>✓ Prerequisites checked</li>
        <li>✓ Claude authenticated</li>
        <li>✓ Defaults saved to ~/.argus/config.json</li>
      </ul>
    </OnboardingLayout>
  );
}
