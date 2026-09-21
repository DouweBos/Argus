import { useCallback, useState } from "react";

interface NotificationPermissionState {
  asking: boolean;
  permission: NotificationPermission;
  request: () => Promise<void>;
  supported: boolean;
}

export function useNotificationPermission(): NotificationPermissionState {
  const supported = typeof Notification !== "undefined";
  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : "denied",
  );
  const [asking, setAsking] = useState(false);

  const request = useCallback(async () => {
    if (!supported) {
      return;
    }
    setAsking(true);
    try {
      // `requestPermission()` is a no-op in Electron on macOS — the OS prompt
      // only fires when a real notification is constructed.
      await Notification.requestPermission();
      const n = new Notification("Notifications enabled", {
        body: "Argus will ping you when agents need your attention.",
      });
      setTimeout(() => n.close(), 2500);
      setPermission(Notification.permission);
    } catch {
      setPermission("denied");
    } finally {
      setAsking(false);
    }
  }, [supported]);

  return { asking, permission, request, supported };
}
