import { useState } from "react";
import { Button, Coachmark } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { OnboardingLayout } from "./OnboardingLayout";

const TOUR = [
  {
    title: "The sidebar",
    description:
      "Each row is a git worktree. Create one per parallel task — agents never trip over each other.",
  },
  {
    title: "The center",
    description:
      "Pick a workspace to see its agent chat, tool calls, diff, and editor. Split-pair two agents side-by-side when you need to compare.",
  },
  {
    title: "Runtime & testing",
    description:
      "Live iOS simulator, Android emulator, or Chromium browser — plus a terminal tab. The right panel is where you verify your agents' work.",
  },
];

export function LayoutTourStep() {
  const { advance } = useOnboarding();
  const [i, setI] = useState(0);

  const next = () => {
    if (i + 1 < TOUR.length) {
      setI(i + 1);
    } else {
      advance("first_workspace").catch(() => {});
    }
  };

  const skip = () => {
    advance("first_workspace").catch(() => {});
  };

  const current = TOUR[i];

  return (
    <OnboardingLayout
      currentStep="layout_tour"
      title="A quick tour"
      subtitle="Three panels you'll use every day. Click through each — or skip straight to spinning up your first workspace."
      footerLeft={
        <Button variant="ghost" onClick={skip}>
          Skip tour
        </Button>
      }
      footerRight={
        <Button variant="primary" onClick={next}>
          {i + 1 < TOUR.length ? "Next" : "Got it"}
        </Button>
      }
    >
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Coachmark
          title={current.title}
          description={current.description}
          progress={`${i + 1} / ${TOUR.length}`}
        />
      </div>
    </OnboardingLayout>
  );
}
