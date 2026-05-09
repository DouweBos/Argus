import { useState } from "react";
import { Button } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { setTelemetryMode } from "../../lib/telemetry";
import {
  setTelemetryModeSetting,
  type TelemetryMode,
} from "../../stores/settingsStore";
import { OnboardingLayout } from "./OnboardingLayout";

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
      await advance("completion");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="telemetry"
      title="Help improve Argus"
      subtitle="Pick how much you want to share. You can change this any time under Settings → Privacy."
      footerLeft={
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            choose("off").catch(() => {});
          }}
        >
          {busy ? "Saving…" : "No telemetry"}
        </Button>
      }
      footerRight={
        <div style={{ display: "flex", gap: 8 }}>
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          fontFamily: "var(--font-ui)",
          color: "var(--text-secondary)",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <Section
          title="No telemetry"
          items={[
            "Nothing leaves your machine. No DAU count, no errors, no feedback channel.",
            "Pick this if even city-level geography (which PostHog derives at ingest) is unacceptable.",
          ]}
        />
        <Section
          title="Just count me"
          items={[
            "One event per launch — anonymous install id + app version, nothing else.",
            "Lets us see roughly how many people are using Argus without learning what anyone does.",
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
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {items.map((item) => (
          <li
            key={item}
            style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
          >
            <span style={{ color: "var(--text-muted)" }}>•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
