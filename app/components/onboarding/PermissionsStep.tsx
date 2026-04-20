import { useState } from "react";
import { Button, ChecklistRow } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { OnboardingLayout } from "./OnboardingLayout";

function notifMessage(
  notifAsked: boolean,
  notifGranted: boolean | null,
): string {
  if (!notifAsked) {
    return "Get a ping when an agent finishes a turn or requests permission while the app is in the background.";
  }
  if (notifGranted) {
    return "Enabled";
  }

  return "Denied — you can enable later in System Settings";
}

function notifTone(
  notifAsked: boolean,
  notifGranted: boolean | null,
): "pass" | "skipped" | "warn" {
  if (notifGranted === true) {
    return "pass";
  }
  if (notifAsked) {
    return "skipped";
  }

  return "warn";
}

export function PermissionsStep() {
  const { advance } = useOnboarding();
  const [notifAsked, setNotifAsked] = useState(false);
  const [notifGranted, setNotifGranted] = useState<boolean | null>(null);

  const askNotifications = async () => {
    setNotifAsked(true);
    try {
      if (!("Notification" in window)) {
        setNotifGranted(false);

        return;
      }
      // `Notification.requestPermission()` is a no-op in Electron on macOS —
      // the OS permission prompt only fires when a real notification is
      // constructed. Fire a test one so macOS asks the user, then read the
      // permission state back.
      await Notification.requestPermission();
      const n = new Notification("Notifications enabled", {
        body: "Argus will ping you when agents need your attention.",
      });
      // Close it shortly after so it doesn't sit in Notification Center.
      setTimeout(() => {
        n.close();
      }, 2500);
      setNotifGranted(Notification.permission === "granted");
    } catch {
      setNotifGranted(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="permissions"
      title="Enable notifications"
      subtitle="Argus can ping you when an agent finishes a turn or needs permission while the app is in the background. On-device only — nothing leaves your Mac."
      footerRight={
        <Button
          variant="primary"
          onClick={() => {
            advance("preflight").catch(() => {});
          }}
        >
          Continue
        </Button>
      }
    >
      <ChecklistRow
        title="Notifications (optional)"
        message={notifMessage(notifAsked, notifGranted)}
        tone={notifTone(notifAsked, notifGranted)}
        action={
          <Button
            variant={notifAsked ? "ghost" : "primary"}
            size="sm"
            onClick={() => {
              askNotifications().catch(() => {});
            }}
          >
            {notifAsked ? "Answered" : "Ask"}
          </Button>
        }
      />
    </OnboardingLayout>
  );
}
