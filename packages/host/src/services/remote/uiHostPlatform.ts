/**
 * The platform for a host with native UIs on its local socket. Per request:
 *
 * - `notify`, `focus_ui`: the host's own asks go to the UI that supervises it
 *   (`platform` role), else the base — Electron's own window, or the headless
 *   no-ops. A viewer never gets them, so one banner shows, not one per window.
 * - `open_external`, `open_path`, `reveal_in_finder`: to the window whose
 *   request triggered it, so the browser or Finder comes forward over the
 *   window you clicked in; host-initiated ones go where `notify` does.
 * - `close_device_popout`: every window, since each keeps its own popouts.
 * - `isForeground`: any Argus window in front counts — a banner is for when
 *   you aren't looking at Argus at all.
 */

import type { LocalUiChannel } from "./localUiSocket";
import type { HostPlatform } from "../../platform";
import { currentConnectionId } from "./connectionScope";

export function uiHostPlatform(
  channel: LocalUiChannel,
  base: HostPlatform,
  /** A Node host run by the Mac app is that app; Electron stays itself. */
  mode: { supervised?: boolean } = { supervised: true },
): HostPlatform {
  const requester = () => channel.requester(currentConnectionId());

  return {
    ...base,
    name: mode.supervised ? "mac" : base.name,
    hasUi: mode.supervised ? true : base.hasUi,
    notificationsSupported: () =>
      channel.hasPlatform || base.notificationsSupported(),
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
    isForeground: () => channel.isForeground() || base.isForeground(),
    focusUi: () => {
      if (!channel.send({ kind: "focus_ui" })) {
        base.focusUi();
      }
    },
    openExternal: async (url) => {
      const request = { kind: "open_external", url } as const;
      const asker = requester();
      if (asker) {
        asker.pushPlatformRequest(request);
      } else if (!channel.send(request)) {
        await base.openExternal(url);
      }
    },
    // The UI reports failures itself; the host only learns it was handed off.
    openPath: async (target) => {
      const request = { kind: "open_path", path: target } as const;
      const asker = requester();
      if (asker) {
        asker.pushPlatformRequest(request);

        return "";
      }

      return channel.send(request) ? "" : await base.openPath(target);
    },
    revealInFinder: (target) => {
      const request = { kind: "reveal_in_finder", path: target } as const;
      const asker = requester();
      if (asker) {
        asker.pushPlatformRequest(request);
      } else if (!channel.send(request)) {
        base.revealInFinder(target);
      }
    },
    closeDevicePopout: (key) => {
      channel.sendAll({ kind: "close_device_popout", key });
      base.closeDevicePopout(key);
    },
  };
}
