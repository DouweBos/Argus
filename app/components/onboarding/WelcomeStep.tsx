import { Button, EmptyStateIllustration } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./WelcomeStep.module.css";

const POINTS = [
  "One git worktree per parallel task — no stashing, no branch juggling.",
  "Claude Code agents you can steer in plan, acceptEdits, or auto mode.",
  "Live iOS / Android / web previews inside the same window.",
];

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
          className={styles.skip}
          onClick={() => {
            complete().catch(() => {});
          }}
        >
          I&apos;ve done this before — skip onboarding
        </button>
      }
      footerRight={
        <Button
          variant="primary"
          onClick={() => {
            advance("telemetry").catch(() => {});
          }}
        >
          Get started
        </Button>
      }
    >
      <ul className={styles.points}>
        {POINTS.map((point) => (
          <li key={point}>• {point}</li>
        ))}
      </ul>
    </OnboardingLayout>
  );
}
