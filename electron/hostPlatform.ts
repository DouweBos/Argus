/**
 * The Electron implementation of `HostPlatform`.
 *
 * Everything `@argus/host` cannot do as plain Node — the user's browser,
 * notification banners, the packaged app's version and resource
 * paths, raising the window — is supplied here. Installed once at boot; a
 * headless host installs `nodeHostPlatform()` instead and every one of these
 * degrades to a documented no-op.
 */

import { Notification, app, safeStorage, shell } from "electron";
import { nodeSecretStorage } from "@argus/host/lib/nodeSecretStorage";
import {
  type HostPlatform,
  nodeHostPlatform,
  setHostPlatform,
} from "@argus/host/platform";
import { getMainWindow } from "./mainWindow";
import { closeDevicePopout } from "./popouts";

const electronHostPlatform: Omit<HostPlatform, "secretStorage"> = {
  name: "electron",
  hasUi: true,

  appVersion: () => app.getVersion(),
  isPackaged: () => app.isPackaged,
  resourcesPath: () => process.resourcesPath,
  userDataPath: () => app.getPath("userData"),

  openExternal: (url) => shell.openExternal(url),
  openPath: (target) => shell.openPath(target),
  revealInFinder: (target) => shell.showItemInFolder(target),

  // Old stores move off it at boot; one that fails to move keeps using it.
  legacySecretStorage: {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
  },

  notificationsSupported: () => Notification.isSupported(),
  notify: ({ title, body, urgency, actions, onAction, onClick }) => {
    const notification = new Notification({
      title,
      body,
      urgency: urgency === "critical" ? "critical" : "normal",
      // Buttons are macOS-only in Electron; elsewhere this is simply ignored.
      actions: (actions ?? []).map((text) => ({ type: "button", text })),
    });
    if (onAction) {
      notification.on("action", (_event, index) => onAction(index));
    }
    if (onClick) {
      notification.on("click", () => onClick());
    }
    notification.show();
  },

  closeDevicePopout,

  isForeground: () => getMainWindow()?.isFocused() ?? false,
  focusUi: () => {
    const win = getMainWindow();
    if (!win) {
      return;
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
  },
};

/**
 * Install the platform for this process. The headless server app has no
 * window, so its UI-shaped capabilities fall back to the Node no-ops while
 * keychain, version and browser handoff stay real.
 *
 * Secrets use the same scheme as the Mac app's host and `argus-host`, so
 * every host on a home can read what another wrote.
 */
export function installHostPlatform(options: { headless: boolean }): void {
  const secretStorage = nodeSecretStorage();
  setHostPlatform(
    options.headless
      ? nodeHostPlatform({
          name: "electron-headless",
          appVersion: electronHostPlatform.appVersion,
          isPackaged: electronHostPlatform.isPackaged,
          resourcesPath: electronHostPlatform.resourcesPath,
          userDataPath: electronHostPlatform.userDataPath,
          openExternal: electronHostPlatform.openExternal,
          openPath: electronHostPlatform.openPath,
          revealInFinder: electronHostPlatform.revealInFinder,
          secretStorage,
          legacySecretStorage: electronHostPlatform.legacySecretStorage,
        })
      : { ...electronHostPlatform, secretStorage },
  );
}
