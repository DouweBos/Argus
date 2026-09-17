/**
 * Opening things in window tabs. Attaching a host and looking at one are
 * separate acts: a tab is a view, and the transport it reads from keeps
 * running whether or not a tab is showing it.
 */

import type { HostId } from "./transport/hostId";
import { sessionHostId } from "../stores/sessionStore";
import {
  activateTab,
  getTabState,
  openTab,
  tabHostId,
} from "../stores/tabStore";
import { routeToPath } from "./router";
import { attachTo } from "./transport";
import { LOCAL_HOST_ID } from "./transport/hostId";
import { isAttached } from "./transport/registry";

/**
 * Show a machine in a tab: focus the tab already reading from it, or open a
 * new one, attaching first when nothing is connected yet.
 */
export async function openHostTab(
  hostId: HostId,
  options: { label?: string; reuse?: boolean } = {},
): Promise<void> {
  if (hostId !== LOCAL_HOST_ID && !isAttached(hostId)) {
    await attachTo(hostId);
  }
  if (options.reuse !== false) {
    const existing = getTabState().tabs.find((t) => tabHostId(t) === hostId);
    if (existing) {
      activateTab(existing.id);

      return;
    }
  }
  openTab({ hostId, title: options.label });
}

/** Open a session in its own tab, on the machine that session lives on. */
export function openSessionTab(sessionId: string, title: string): void {
  openTab({
    path: routeToPath({
      view: "session",
      sessionId,
      panel: "home",
      hostId: sessionHostId(sessionId),
    }),
    title,
  });
}
