import { useState } from "react";
import { Button } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { setTelemetryMode } from "../../lib/telemetry";
import {
  setTelemetryModeSetting,
  type TelemetryMode,
} from "../../stores/settingsStore";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./TelemetryStep.module.css";

export function TelemetryStep() {
  const { advance } = useOnboarding();
  const [busy, setBusy] = useState(false);

  const choose = async (mode: TelemetryMode) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setTelemetryModeSetting(mode);
    setTelemetryMode(mode);
    try {
      await advance("projects");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="telemetry"
      title="Help improve Argus"
      subtitle="Pick how much you want to share. Anything still missing on your Mac — the Claude CLI, a signed-in account, git identity — shows up as a card on the home screen. You can change this any time under Settings → Privacy."
      footerRight={
        <div className={styles.choices}>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              choose("presence").catch(() => {});
            }}
          >
            {busy ? "Saving…" : "Just count me"}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              choose("full").catch(() => {});
            }}
          >
            {busy ? "Saving…" : "Share anonymous data"}
          </Button>
        </div>
      }
    >
      <div className={styles.sections}>
        <Section
          title="Just count me"
          items={[
            "One event per launch — anonymous install id + app version, nothing else.",
            "Lets us see roughly how many people are using Argus without learning what anyone does.",
            "This is the minimum — Argus always sends this heartbeat.",
          ]}
        />
        <Section
          title="Share anonymous data"
          items={[
            "App version, OS, OS version, Electron/Node version, CPU arch.",
            "Feature usage events (which screens you open, which actions you take).",
            "Errors and crashes from the main and renderer processes.",
            "Any feedback you submit through the in-app feedback button.",
          ]}
        />
        <Section
          title="What we never collect"
          items={[
            "Your IP address (PostHog discards it after deriving country/city) or screen recordings.",
            "Prompts, file contents, agent output, project names, branch names, repo paths.",
            "Anything that ties your install id to a person, account, or machine.",
          ]}
        />
      </div>
    </OnboardingLayout>
  );
}

function Section({ title, items }: { items: string[]; title: string }) {
  return (
    <div>
      <div className={styles.sectionTitle}>{title}</div>
      <ul className={styles.items}>
        {items.map((item) => (
          <li key={item} className={styles.item}>
            <span className={styles.bullet}>•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
