import { useState } from "react";
import { Button } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { setTelemetryEnabled } from "../../lib/telemetry";
import { setTelemetryEnabledSetting } from "../../stores/settingsStore";
import { OnboardingLayout } from "./OnboardingLayout";

export function TelemetryStep() {
  const { advance } = useOnboarding();
  const [busy, setBusy] = useState(false);

  const choose = async (enabled: boolean) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setTelemetryEnabledSetting(enabled);
    setTelemetryEnabled(enabled);
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
      subtitle="Argus can send anonymous usage and crash data so we can spot bugs and prioritize what to build next. Your call — change it later under Settings → Privacy."
      footerLeft={
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            choose(false).catch(() => {});
          }}
        >
          {busy ? "Saving…" : "No thanks"}
        </Button>
      }
      footerRight={
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            choose(true).catch(() => {});
          }}
        >
          {busy ? "Saving…" : "Share anonymous data"}
        </Button>
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
          title="What we collect"
          items={[
            "Anonymous install id (random UUID, stored at ~/.argus/telemetry-id)",
            "App version, OS, OS version, Electron/Node version, CPU arch",
            "Feature usage events (which screens you open, which actions you take)",
            "Errors and crashes from the main and renderer processes",
            "Any feedback you submit through the in-app feedback button",
          ]}
        />
        <Section
          title="What we do not collect"
          items={[
            "Your IP address, geolocation, or screen recordings",
            "Prompts, file contents, agent output, project names, branch names, repo paths",
            "Anything that ties your install id to a person, account, or machine",
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
