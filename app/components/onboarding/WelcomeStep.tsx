import { Button, EmptyStateIllustration } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { OnboardingLayout } from "./OnboardingLayout";

export function WelcomeStep() {
  const { advance, complete } = useOnboarding();

  return (
    <OnboardingLayout
      currentStep="welcome"
      hero={<EmptyStateIllustration variant="welcome" size={140} />}
      title="Welcome to Argus"
      subtitle="An agentic IDE for mobile and web. Argus orchestrates parallel Claude Code agents in isolated git worktrees, each with live iOS simulators, Android emulators, and a browser for instant testing."
      footerLeft={
        <button
          type="button"
          onClick={() => {
            complete().catch(() => {});
          }}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "var(--font-ui)",
          }}
        >
          I&apos;ve done this before — skip onboarding
        </button>
      }
      footerRight={
        <Button
          variant="primary"
          onClick={() => {
            advance("permissions").catch(() => {});
          }}
        >
          Get started
        </Button>
      }
    >
      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 0,
          margin: 0,
          listStyle: "none",
          fontFamily: "var(--font-ui)",
          color: "var(--text-secondary)",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        <li>
          • One git worktree per parallel task — no stashing, no branch
          juggling.
        </li>
        <li>
          • Claude Code agents you can steer in plan, acceptEdits, or auto mode.
        </li>
        <li>• Live iOS / Android / web previews inside the same window.</li>
      </ul>
    </OnboardingLayout>
  );
}
