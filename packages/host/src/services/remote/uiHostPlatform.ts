/**
 * The platform for a Node host with a native UI on its local socket: the
 * window-shaped capabilities are forwarded to the app as `platform.request`
 * events, and fall back to the headless no-ops whenever no UI is attached.
 */

import type { LocalUiChannel } from "./localUiSocket";
import type { HostPlatform } from "../../platform";

export function uiHostPlatform(
  channel: LocalUiChannel,
  base: HostPlatform,
): HostPlatform {
  return {
    ...base,
    name: "mac",
    hasUi: true,
    notificationsSupported: () =>
      channel.attached || base.notificationsSupported(),
    notify: (options) => {
      const shown = channel.notify(
        {
          title: options.title,
          body: options.body,
          urgency: options.urgency ?? "normal",
          actions: options.actions ?? [],
        },
        { onAction: options.onAction, onClick: options.onClick },
      );
      if (!shown) {
        base.notify(options);
      }
    },
    isForeground: () => channel.isForeground(),
    focusUi: () => {
      if (!channel.send({ kind: "focus_ui" })) {
        base.focusUi();
      }
    },
    openExternal: async (url) => {
      if (!channel.send({ kind: "open_external", url })) {
        await base.openExternal(url);
      }
    },
    // The UI reports failures itself; the host only learns it was handed off.
    openPath: async (target) =>
      channel.send({ kind: "open_path", path: target })
        ? ""
        : await base.openPath(target),
    revealInFinder: (target) => {
      if (!channel.send({ kind: "reveal_in_finder", path: target })) {
        base.revealInFinder(target);
      }
    },
    closeDevicePopout: (key) => {
      if (!channel.send({ kind: "close_device_popout", key })) {
        base.closeDevicePopout(key);
      }
    },
  };
}
