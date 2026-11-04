/**
 * The server tray's account section as a plain model: what `login`, `approve`,
 * `account` and `logout` do in `argus-host`'s console, rendered as menu items.
 * Pure so it can be tested without Electron; `accountTray.ts` wires it up.
 */

import type { ManagedTunnelState } from "@argus/host/services/remote/managedTunnel";
import type {
  AccountApprovalState,
  AccountJoinRequest,
  AccountStatus,
} from "@argus/remote-protocol";

export type AccountTrayAction =
  { kind: "approval_confirm"; match: boolean } | { kind: "approval_dismiss" } | { kind: "approve"; requestId: string } | { kind: "deny"; requestId: string } | { kind: "link_cancel" } | { kind: "link_confirm"; match: boolean } | { kind: "link_copy_code"; code: string } | { kind: "link_open"; url: string } | { kind: "link_start" } | { kind: "notice_dismiss" } | { kind: "rename_default" } | { kind: "rename"; current: string } | { kind: "reset_dismiss" } | { kind: "tunnel"; on: boolean } | { kind: "unlink" };

export type AccountMenuEntry =
  | {
      type?: "item";
      label: string;
      action?: AccountTrayAction;
      /** Set → rendered as a checkbox. */
      checked?: boolean;
      enabled?: boolean;
      submenu?: AccountMenuEntry[];
    }
  | { type: "separator" };

export interface AccountTraySnapshot {
  status: Pick<
    AccountStatus,
    | "config"
    | "link"
    | "linked"
    | "name"
    | "reset"
    | "safety_code"
    | "system_name"
  >;
  approval: AccountApprovalState;
  tunnel: Pick<ManagedTunnelState, "phase" | "reason" | "url">;
  requests: AccountJoinRequest[];
  /** This computer as the account service sees it; null until first checked. */
  online: boolean | null;
  /** The last action's failure, shown until dismissed or the next action. */
  notice: string | null;
}

function info(label: string): AccountMenuEntry {
  return { label, enabled: false };
}

function spaced(sas: string): string {
  return `${sas.slice(0, 3)} ${sas.slice(3)}`;
}

function noun(role: "device" | "host"): string {
  return role === "host" ? "computer" : "device";
}

function withoutScheme(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, "").replace(/\/$/, "");
}

export function tunnelLine(tunnel: AccountTraySnapshot["tunnel"]): string {
  switch (tunnel.phase) {
    case "running":
      return tunnel.url
        ? `Managed tunnel: ${withoutScheme(tunnel.url)}`
        : "Managed tunnel: running";
    case "off":
      if (tunnel.reason === "remote_off") {
        return "Managed tunnel: off (remote access is off)";
      }

      return tunnel.reason === "account_paused"
        ? "Managed tunnel: paused"
        : "Managed tunnel: off";
    case "installing":
      return "Managed tunnel: installing cloudflared…";
    case "provisioning":
    case "starting":
      return "Managed tunnel: starting…";
    case "unavailable":
      return "Managed tunnel: unavailable";
    case "error":
      return "Managed tunnel: failed";
  }
}

function presenceLine(s: AccountTraySnapshot): string {
  if (!s.status.config.enabled) {
    return "Account paused on this computer";
  }
  if (s.online === null) {
    return "Checking whether it's online…";
  }

  return s.online ? "Online" : "Offline — the account hasn't seen it lately";
}

function linkEntries(s: AccountTraySnapshot): AccountMenuEntry[] {
  const link = s.status.link;
  const cancel: AccountMenuEntry = {
    label: "Cancel Linking",
    action: { kind: "link_cancel" },
  };
  switch (link.kind) {
    case "awaiting_claim":
      return [
        info(
          `Enter ${link.user_code} at ${withoutScheme(link.verification_uri)}`,
        ),
        info("or type it into the Argus app on your phone or Mac"),
        {
          label: "Copy Code",
          action: { kind: "link_copy_code", code: link.user_code },
        },
        {
          label: `Open ${withoutScheme(link.verification_uri)}`,
          action: { kind: "link_open", url: link.verification_uri_complete },
        },
        cancel,
      ];
    case "awaiting_first":
      return [
        info("Your account has no computers yet"),
        {
          label: "Make This Computer the First",
          action: { kind: "link_confirm", match: true },
        },
        cancel,
      ];
    case "awaiting_sas":
      return [
        info(`Approval requested by "${link.approver_name}"`),
        info(`Confirm this matches: ${spaced(link.sas)}`),
        {
          label: "Codes Match — Link",
          action: { kind: "link_confirm", match: true },
        },
        {
          label: "Codes Differ — Cancel",
          action: { kind: "link_confirm", match: false },
        },
      ];
    case "awaiting_approval":
      return [info("Confirmed here. Waiting for the other side…"), cancel];
    case "error":
      return [
        info(`Linking failed: ${link.message}`),
        { label: "Link to Argus Account…", action: { kind: "link_start" } },
      ];
    case "idle":
    case "linked":
      return [
        { label: "Link to Argus Account…", action: { kind: "link_start" } },
      ];
  }
}

function approvalEntries(s: AccountTraySnapshot): AccountMenuEntry[] {
  const approval = s.approval;
  const dismiss: AccountMenuEntry = {
    label: "Dismiss",
    action: { kind: "approval_dismiss" },
  };
  switch (approval.kind) {
    case "awaiting_sas":
      return [
        info(
          `Approving "${approval.subject_name}" (${noun(approval.subject_role)})`,
        ),
        info(`Confirm this matches: ${spaced(approval.sas)}`),
        {
          label: "Codes Match — Approve",
          action: { kind: "approval_confirm", match: true },
        },
        {
          label: "Codes Differ — Deny",
          action: { kind: "approval_confirm", match: false },
        },
      ];
    case "approved":
      return [
        info(
          `Approved. That ${noun(approval.subject_role)} is now on your account`,
        ),
        dismiss,
      ];
    case "error":
      return [info(`Approval failed: ${approval.message}`), dismiss];
    case "idle":
      return [];
  }
}

function waitingEntries(s: AccountTraySnapshot): AccountMenuEntry[] {
  const n = s.requests.length;
  if (n === 0) {
    return [];
  }
  // `account set approve off`: say why rather than hide the queue.
  if (!s.status.config.hosts_can_approve) {
    return [info(`Waiting to join (${n}) — approving here is off`)];
  }
  const busy = s.approval.kind === "awaiting_sas";

  return [
    {
      label: `Waiting to join (${n})`,
      enabled: !busy,
      submenu: s.requests.map((r) => ({
        label: `${r.subject_name} (${noun(r.subject_role)})`,
        submenu: [
          {
            label: "Approve…",
            action: { kind: "approve", requestId: r.request_id },
          },
          { label: "Deny", action: { kind: "deny", requestId: r.request_id } },
        ],
      })),
    },
  ];
}

function settingsEntry(s: AccountTraySnapshot): AccountMenuEntry {
  const { config, name, system_name, safety_code } = s.status;
  const submenu: AccountMenuEntry[] = [];
  if (safety_code) {
    submenu.push(info(`Account safety code: ${safety_code}`));
    submenu.push({ type: "separator" });
  }
  submenu.push({
    label: "Managed Tunnel",
    checked: config.tunnel,
    action: { kind: "tunnel", on: !config.tunnel },
  });
  submenu.push({
    label: "This Computer's Name…",
    action: { kind: "rename", current: name ?? system_name ?? "" },
  });
  if (system_name && name !== system_name) {
    submenu.push({
      label: `Use System Name (${system_name})`,
      action: { kind: "rename_default" },
    });
  }
  submenu.push({ type: "separator" });
  submenu.push({ label: "Unlink…", action: { kind: "unlink" } });

  return { label: "Argus Account", submenu };
}

/** The account section of the server tray, top to bottom. */
export function accountMenuModel(s: AccountTraySnapshot): AccountMenuEntry[] {
  const out: AccountMenuEntry[] = [];
  if (s.notice) {
    out.push(info(s.notice), {
      label: "Dismiss",
      action: { kind: "notice_dismiss" },
    });
  }
  const reset = s.status.reset;
  if (!s.status.linked && reset && s.status.link.kind === "idle") {
    const by = reset.by_name ? ` from "${reset.by_name}"` : "";

    return [
      ...out,
      info(`This account was reset${by}`),
      info("Link this computer again to keep using it"),
      {
        label: "Link to Argus Account…",
        action: { kind: "link_start" },
      },
      { label: "Dismiss", action: { kind: "reset_dismiss" } },
    ];
  }
  if (!s.status.linked) {
    return [...out, ...linkEntries(s)];
  }
  out.push(
    info(
      s.status.name
        ? `Argus Account: linked as "${s.status.name}"`
        : "Argus Account: linked",
    ),
    info(presenceLine(s)),
    info(tunnelLine(s.tunnel)),
    ...approvalEntries(s),
    ...waitingEntries(s),
    settingsEntry(s),
  );

  return out;
}
