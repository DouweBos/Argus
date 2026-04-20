import { useState } from "react";
import { Button, ChecklistRow } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { ensureArgusDir } from "../../lib/ipc";
import { OnboardingLayout } from "./OnboardingLayout";

export function PermissionsStep() {
  const { advance } = useOnboarding();
  const [fsGranted, setFsGranted] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  const [notifAsked, setNotifAsked] = useState(false);
  const [notifGranted, setNotifGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const grantFs = async () => {
    setBusy(true);
    setFsError(null);
    try {
      await ensureArgusDir();
      setFsGranted(true);
    } catch (err) {
      setFsError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const askNotifications = async () => {
    setNotifAsked(true);
    try {
      if ("Notification" in window) {
        const r = await Notification.requestPermission();
        setNotifGranted(r === "granted");
      } else {
        setNotifGranted(false);
      }
    } catch {
      setNotifGranted(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="permissions"
      title="Grant a couple of permissions"
      subtitle="Argus writes workspace state to ~/.argus/ and can send a notification when an agent finishes. Both are on-device — nothing leaves your Mac."
      footerRight={
        <Button
          variant="primary"
          disabled={!fsGranted}
          onClick={() => {
            advance("preflight").catch(() => {});
          }}
        >
          Continue
        </Button>
      }
    >
      <ChecklistRow
        title="File access for ~/.argus/"
        message={
          fsGranted
            ? "Ready"
            : (fsError ??
              "Argus stores worktrees, logs, and cached state under your home directory.")
        }
        tone={fsGranted ? "pass" : fsError ? "fail" : "warn"}
        action={
          <Button
            variant={fsGranted ? "ghost" : "primary"}
            size="sm"
            disabled={busy || fsGranted}
            onClick={() => {
              grantFs().catch(() => {});
            }}
          >
            {fsGranted ? "Granted" : "Grant"}
          </Button>
        }
      />
      <ChecklistRow
        title="Notifications (optional)"
        message={
          notifAsked
            ? notifGranted
              ? "Enabled"
              : "Denied — you can enable later in System Settings"
            : "Get a ping when an agent finishes a long task."
        }
        tone={notifGranted === true ? "pass" : notifAsked ? "skipped" : "warn"}
        action={
          <Button
            variant={notifAsked ? "ghost" : "secondary"}
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
