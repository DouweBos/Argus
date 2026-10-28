import { useCallback, useEffect, useState } from "react";
import { Icons } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { listIntegrations, takeDeviceScreenshot } from "../../../lib/ipc";
import { useSessions } from "../../../stores/sessionStore";
import { useDeviceLabel } from "../../../stores/simulatorStore";
import { FileIssueDialog } from "./FileIssueDialog";

interface FileIssueButtonProps {
  className: string;
  deviceKey: string;
  platform: "android" | "ios";
  sessionId: string;
}

/** Title-bar button: screenshot the device and file it in Linear. Hidden until Linear is connected. */
export function FileIssueButton({
  className,
  deviceKey,
  platform,
  sessionId,
}: FileIssueButtonProps) {
  const [connected, setConnected] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null | undefined>();
  const deviceLabel = useDeviceLabel(platform, deviceKey);
  const repoRoot =
    useSessions().find((s) => s.id === sessionId)?.repo_root ?? null;

  const refresh = useCallback(() => {
    listIntegrations().then(
      (all) =>
        setConnected(
          all.some((s) => s.id === "linear" && s.connected && !s.needsReauth),
        ),
      () => setConnected(false),
    );
  }, []);
  useEffect(refresh, [refresh]);
  useIpcEvent("integration_status_changed", refresh);

  if (!connected) {
    return null;
  }

  const open = () => {
    setCapturing(true);
    takeDeviceScreenshot(platform, deviceKey)
      .catch(() => null)
      .then((png) => {
        setScreenshot(png);
        setCapturing(false);
      });
  };

  return (
    <>
      <button
        className={className}
        disabled={capturing}
        title="File what's on screen in Linear"
        type="button"
        onClick={open}
      >
        <Icons.LinearIcon size={11} />
      </button>
      {screenshot !== undefined && (
        <FileIssueDialog
          deviceLabel={deviceLabel}
          repoRoot={repoRoot}
          screenshot={screenshot}
          onClose={() => setScreenshot(undefined)}
        />
      )}
    </>
  );
}
