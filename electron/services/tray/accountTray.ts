/**
 * The server tray's account actions. Every action calls the same host service
 * as `argus-host`'s console words, so the two can't drift; this file only adds
 * the native bits a menu can't carry (a name prompt, an unlink confirmation).
 */

import type { AccountJoinRequest } from "@argus/remote-protocol";
import { app, clipboard, dialog, shell } from "electron";
import { execFile } from "node:child_process";
import { addHostEventSink } from "@argus/host/bus";
import {
  approveJoin,
  confirmJoin,
  denyJoin,
  dismissApproval,
  listRequests,
} from "@argus/host/services/account/approvals";
import {
  cancelLink,
  confirmLink,
  startLink,
} from "@argus/host/services/account/link";
import { setComputerName } from "@argus/host/services/account/name";
import {
  listHosts,
  logout,
  switchManagedTunnel,
} from "@argus/host/services/account/service";
import {
  accountStatus,
  getApprovalState,
} from "@argus/host/services/account/status";
import { getManagedTunnelState } from "@argus/host/services/remote/managedTunnel";
import {
  accountMenuModel,
  type AccountMenuEntry,
  type AccountTrayAction,
} from "./accountMenu";

/** Join requests and presence need the network; the menu reads this cache. */
const REMOTE_REFRESH_MS = 60_000;

let requests: AccountJoinRequest[] = [];
let online: boolean | null = null;
let notice: string | null = null;
let onChange: (() => void) | null = null;
let unsubscribe: (() => void) | null = null;
let timer: NodeJS.Timeout | null = null;
let refreshing = false;

function changed(): void {
  onChange?.();
}

async function refreshRemote(): Promise<void> {
  if (refreshing) {
    return;
  }
  const status = accountStatus();
  if (!status.linked || !status.config.enabled) {
    requests = [];
    online = null;
    changed();

    return;
  }
  refreshing = true;
  try {
    const [nextRequests, hosts] = await Promise.all([
      listRequests().catch(() => requests),
      listHosts().catch(() => null),
    ]);
    requests = nextRequests;
    online = hosts?.find((h) => h.is_self)?.online ?? online;
  } finally {
    refreshing = false;
  }
  changed();
}

function fail(err: unknown): void {
  notice = err instanceof Error ? err.message : String(err);
  changed();
}

/** The name prompt: a menu can't take text, and the server has no window. */
function promptForName(current: string): Promise<string | null> {
  const script = [
    "on run argv",
    "activate",
    'set r to display dialog "This computer\'s name on your Argus account" default answer (item 1 of argv) buttons {"Cancel", "Rename"} default button "Rename" cancel button "Cancel" with title "Argus Server"',
    "return text returned of r",
    "end run",
  ];

  return new Promise((resolve) => {
    execFile(
      "osascript",
      [...script.flatMap((line) => ["-e", line]), current],
      (err, stdout) => resolve(err ? null : stdout.replace(/\n$/, "")),
    );
  });
}

async function confirmUnlink(): Promise<boolean> {
  app.focus({ steal: true });
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: "Unlink this computer from your Argus account?",
    detail:
      "Devices signed in to your account can no longer find or reach it. Devices paired with a code keep working.",
    buttons: ["Unlink", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });

  return response === 0;
}

async function perform(action: AccountTrayAction): Promise<void> {
  switch (action.kind) {
    case "link_start": {
      const state = await startLink("server_tray");
      if (state.kind === "awaiting_claim") {
        clipboard.writeText(state.user_code);
      }

      return;
    }
    case "link_copy_code":
      clipboard.writeText(action.code);

      return;
    case "link_open":
      await shell.openExternal(action.url);

      return;
    case "link_confirm":
      await confirmLink(action.match);

      return;
    case "link_cancel":
      await cancelLink();

      return;
    case "approve":
      await approveJoin(action.requestId, "server_tray");

      return;
    case "deny":
      await denyJoin(action.requestId, "server_tray");
      await refreshRemote();

      return;
    case "approval_confirm":
      await confirmJoin(action.match);
      await refreshRemote();

      return;
    case "approval_dismiss":
      dismissApproval();

      return;
    case "tunnel":
      await switchManagedTunnel(action.on, "server_tray");

      return;
    case "rename": {
      const name = await promptForName(action.current);
      if (name !== null && name !== action.current) {
        await setComputerName(name, "server_tray");
      }

      return;
    }
    case "rename_default":
      await setComputerName(null, "server_tray");

      return;
    case "unlink":
      if (await confirmUnlink()) {
        await logout();
      }

      return;
    case "notice_dismiss":
      return;
  }
}

function run(action: AccountTrayAction): void {
  notice = null;
  changed();
  perform(action).then(changed, fail);
}

function toElectron(
  entry: AccountMenuEntry,
): Electron.MenuItemConstructorOptions {
  if (entry.type === "separator") {
    return { type: "separator" };
  }
  const { action } = entry;

  return {
    label: entry.label,
    enabled: entry.enabled ?? true,
    ...(entry.checked === undefined
      ? {}
      : { type: "checkbox" as const, checked: entry.checked }),
    ...(entry.submenu ? { submenu: entry.submenu.map(toElectron) } : {}),
    ...(action ? { click: () => run(action) } : {}),
  };
}

/** The account section, built from live host state plus the cached lists. */
export function accountMenuItems(): Electron.MenuItemConstructorOptions[] {
  const status = accountStatus();

  return accountMenuModel({
    status,
    approval: getApprovalState(),
    tunnel: getManagedTunnelState(),
    requests: status.linked ? requests : [],
    online: status.linked ? online : null,
    notice,
  }).map(toElectron);
}

export function initAccountTray(listener: () => void): void {
  if (unsubscribe) {
    return;
  }
  onChange = listener;
  let linked = accountStatus().linked;
  unsubscribe = addHostEventSink((channel) => {
    if (
      channel === "account:approval-state" ||
      channel === "account:link-state"
    ) {
      changed();
    } else if (channel === "account:status") {
      const next = accountStatus().linked;
      if (next !== linked) {
        linked = next;
        refreshRemote().catch(() => undefined);
      }
      changed();
    }
  });
  timer = setInterval(() => {
    refreshRemote().catch(() => undefined);
  }, REMOTE_REFRESH_MS);
  timer.unref?.();
  refreshRemote().catch(() => undefined);
}

export function destroyAccountTray(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  onChange = null;
  requests = [];
  online = null;
  notice = null;
}
