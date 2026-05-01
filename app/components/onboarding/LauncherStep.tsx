import { useEffect, useState } from "react";
import { Button } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import {
  getLauncherStatus,
  type LauncherStatus,
  openAccessibilitySettings,
  setLauncherEnabled,
} from "../../lib/ipc";
import { OnboardingLayout } from "./OnboardingLayout";

/**
 * Onboarding step that asks whether to enable the global session launcher
 * and walks the user through granting Accessibility permission for the
 * native double-tap-right-Option helper.
 *
 * Decline → launcher stays off; can be turned on later under Settings.
 * Enable → registers the global shortcut + spawns the helper, then offers
 * a "Open System Settings" link if Accessibility hasn't been granted yet.
 */
export function LauncherStep() {
  const { advance } = useOnboarding();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<LauncherStatus | null>(null);
  const [phase, setPhase] = useState<"choose" | "permission">("choose");

  // Poll launcher status while the permission step is showing — when the
  // user grants Accessibility, the indicator flips to green without a
  // manual refresh.
  useEffect(() => {
    if (phase !== "permission") {
      return;
    }
    let cancelled = false;
    const tick = () => {
      getLauncherStatus()
        .then((s) => {
          if (!cancelled) {
            setStatus(s);
          }
        })
        .catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phase]);

  const decline = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await setLauncherEnabled(false);
      await advance("telemetry");
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await setLauncherEnabled(true);
      const s = await getLauncherStatus();
      setStatus(s);
      setPhase("permission");
    } finally {
      setBusy(false);
    }
  };

  const continueToTelemetry = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await advance("telemetry");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "choose") {
    return (
      <OnboardingLayout
        currentStep="launcher"
        title="Quick-launch agents from anywhere"
        subtitle="Argus can install a global hotkey that opens a small floating prompt over whatever you're doing — pick a project, optionally a session, and start an agent without switching windows."
        footerLeft={
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              decline().catch(() => undefined);
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
              accept().catch(() => undefined);
            }}
          >
            {busy ? "Enabling…" : "Enable launcher"}
          </Button>
        }
      >
        <BulletList
          heading="What you get"
          items={[
            "Cmd+Shift+Space anywhere on your machine summons the launcher.",
            "Optional: double-tap the right Option key (requires macOS Accessibility permission).",
            "Pick any registered project, attach images, drag-screenshot a region, and start an agent in seconds.",
          ]}
        />
        <BulletList
          heading="Off by default"
          items={[
            "Nothing is registered until you enable it here.",
            "Toggle later under Settings → Session launcher.",
          ]}
        />
      </OnboardingLayout>
    );
  }

  // ---- Permission phase ----
  const granted = status?.accessibilityGranted === true;

  return (
    <OnboardingLayout
      currentStep="launcher"
      title={
        granted ? "Launcher is ready" : "One more permission for full power"
      }
      subtitle={
        granted
          ? "Cmd+Shift+Space and double-tap right Option both work now."
          : "Cmd+Shift+Space already works. To also support double-tapping the right Option key, macOS needs to grant Argus the Accessibility permission. Without it, that part of the launcher silently does nothing."
      }
      footerLeft={
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            continueToTelemetry().catch(() => undefined);
          }}
        >
          Skip for now
        </Button>
      }
      footerRight={
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            continueToTelemetry().catch(() => undefined);
          }}
        >
          Continue
        </Button>
      }
    >
      <BulletList
        heading="Status"
        items={[
          `Cmd+Shift+Space: registered.`,
          `Double-tap right Option: ${
            granted
              ? "active."
              : "needs Accessibility permission. Check System Settings → Privacy & Security → Accessibility, then come back here. The status updates automatically."
          }`,
        ]}
      />
      {!granted && (
        <div style={{ marginTop: 12 }}>
          <Button
            variant="secondary"
            onClick={() => openAccessibilitySettings().catch(() => undefined)}
          >
            Open System Settings
          </Button>
        </div>
      )}
    </OnboardingLayout>
  );
}

function BulletList({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {heading}
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          color: "var(--text-secondary)",
          fontSize: 13,
          lineHeight: 1.5,
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
