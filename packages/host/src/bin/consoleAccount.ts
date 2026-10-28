/**
 * Account words for the terminal the host runs in (§5.9): `login` links this
 * computer with a code, `approve` approves another computer's link or a new
 * device's join from this console, `account` shows where things stand, `logout` unlinks.
 */

import type {
  AccountApprovalState,
  AccountConfigPatch,
  AccountLinkState,
} from "@argus/remote-protocol";
import { addHostEventSink } from "../bus";
import {
  approveJoin,
  confirmJoin,
  listRequests,
} from "../services/account/approvals";
import { cancelLink, confirmLink, startLink } from "../services/account/link";
import {
  getAccountStatus,
  listHosts,
  listMembers,
  logout,
  setAccountConfig,
} from "../services/account/service";
import { getApprovalState, getLinkState } from "../services/account/status";

const YES_NO: Record<string, boolean> = {
  y: true,
  yes: true,
  n: false,
  no: false,
};

function noun(role: "device" | "host"): string {
  return role === "host" ? "computer" : "device";
}

function spaced(sas: string): string {
  return `${sas.slice(0, 3)} ${sas.slice(3)}`;
}

function describeLink(state: AccountLinkState): string | null {
  switch (state.kind) {
    case "awaiting_claim":
      return [
        `Open ${state.verification_uri} and enter  ${state.user_code}   (expires in 10 min)`,
        "or type the code into the Argus app on your phone or Mac.",
        "Waiting…",
      ].join("\n  ");
    case "awaiting_first":
      return "Your account has no computers yet. Make this computer the first? [y/N]";
    case "awaiting_sas":
      return `Approval requested by "${state.approver_name}". Code there: ${spaced(state.sas)}\nDoes it match? [y/N]`;
    case "awaiting_approval":
      return "Confirmed here. Waiting for the other side to finish…";
    case "linked":
      return "Linked. This computer now shows up on your devices.";
    case "error":
      return `Linking failed: ${state.message}`;
    case "idle":
      return null;
  }
}

function describeApproval(state: AccountApprovalState): string | null {
  switch (state.kind) {
    case "awaiting_sas":
      return `Approving "${state.subject_name}". Code on that ${noun(state.subject_role)}: ${spaced(state.sas)}\nDoes it match? [y/N]`;
    case "approved":
      return `Approved. That ${noun(state.subject_role)} is now on your account.`;
    case "error":
      return `Approval failed: ${state.message}`;
    case "idle":
      return null;
  }
}

async function printAccount(print: (line: string) => void): Promise<void> {
  const status = await getAccountStatus();
  if (!status.linked) {
    print('Not linked to an account. Type "login" to link this computer.');

    return;
  }
  print(`Linked. Account safety code: ${status.safety_code}`);
  for (const host of await listHosts()) {
    const where = host.online ? "online" : "offline";
    print(`  ${host.name}${host.is_self ? " (this computer)" : ""} — ${where}`);
  }
  for (const device of listMembers().filter((m) => m.role === "device")) {
    print(`  ${device.name} — ${device.kind} device`);
  }
  const waiting = await listRequests().catch(() => []);
  if (waiting.length > 0) {
    print(`${waiting.length} waiting to join. Type "approve" to review.`);
  }
}

const SWITCHES: Record<string, (on: boolean) => AccountConfigPatch> = {
  enabled: (on) => ({ enabled: on }),
  lan: (on) => ({ publish: { lan: on } }),
  tailscale: (on) => ({ publish: { tailscale: on } }),
  cloudflare: (on) => ({ publish: { cloudflare: on } }),
  approve: (on) => ({ hosts_can_approve: on }),
};
const GRANTS = ["monitor", "control", "admin"] as const;

/** `account set <key> <value>`: the settings of §8 from the terminal. */
function settingPatch(key: string, value: string): AccountConfigPatch | null {
  if (SWITCHES[key] && (value === "on" || value === "off")) {
    return SWITCHES[key](value === "on");
  }
  const grant = GRANTS.find((g) => g === value);
  if (key === "ios" && grant && grant !== "admin") {
    return { grants: { ios: grant } };
  }
  if (key === "desktop" && grant) {
    return { grants: { desktop: grant } };
  }
  if (key === "service") {
    return { service_url: value === "default" ? "" : value };
  }

  return null;
}

async function setSetting(
  args: string[],
  print: (line: string) => void,
): Promise<void> {
  const patch = settingPatch(args[0] ?? "", args[1] ?? "");
  if (!patch) {
    print(
      "account set enabled|lan|tailscale|cloudflare|approve on|off, account set ios monitor|control, account set desktop monitor|control|admin, account set service <url>|default",
    );

    return;
  }
  await setAccountConfig(patch);
  print("Saved.");
}

async function approve(
  arg: string,
  print: (line: string) => void,
): Promise<void> {
  const requests = await listRequests();
  if (requests.length === 0) {
    print("Nothing is waiting to join your account.");

    return;
  }
  const index = arg ? Number(arg) - 1 : 0;
  if (requests.length > 1 && !arg) {
    requests.forEach((r, i) =>
      print(`  ${i + 1}. ${r.subject_name} (${noun(r.subject_role)})`),
    );
    print('Type "approve <number>".');

    return;
  }
  const request = requests[index];
  if (!request) {
    print("No such request.");

    return;
  }
  await approveJoin(request.request_id);
}

/**
 * Handle one console line if it belongs to the account flow. Returns false
 * for anything else so the pairing console can answer it.
 */
export function attachConsoleAccount(
  print: (line: string) => void,
): (input: string) => boolean {
  addHostEventSink((channel, args) => {
    let line: string | null = null;
    if (channel === "account:link-state") {
      line = describeLink(args[0] as AccountLinkState);
    } else if (channel === "account:approval-state") {
      line = describeApproval(args[0] as AccountApprovalState);
    }
    if (line) {
      print(line);
    }
  });
  const fail = (err: unknown) =>
    print(err instanceof Error ? err.message : String(err));

  return (input) => {
    const [word = "", arg = "", ...rest] = input.trim().split(/\s+/);
    const lower = word.toLowerCase();
    const answer = YES_NO[lower] ?? null;
    const link = getLinkState().kind;
    if (
      answer !== null &&
      (link === "awaiting_first" || link === "awaiting_sas")
    ) {
      confirmLink(answer).catch(fail);

      return true;
    }
    if (answer !== null && getApprovalState().kind === "awaiting_sas") {
      confirmJoin(answer).catch(fail);

      return true;
    }
    switch (lower) {
      case "login":
        startLink("cli").catch(fail);

        return true;
      case "logout":
        logout()
          .then(() => print("Unlinked from your account."))
          .catch(fail);

        return true;
      case "approve":
        approve(arg, print).catch(fail);

        return true;
      case "account":
        if (arg === "set") {
          setSetting(rest, print).catch(fail);
        } else {
          printAccount(print).catch(fail);
        }

        return true;
      case "cancel":
        if (link !== "idle" && link !== "linked") {
          cancelLink().catch(fail);

          return true;
        }

        return false;
      default:
        return false;
    }
  };
}
