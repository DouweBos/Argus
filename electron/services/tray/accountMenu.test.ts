import type { AccountJoinRequest } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  accountMenuModel,
  type AccountMenuEntry,
  type AccountTraySnapshot,
} from "./accountMenu";

const CONFIG = {
  enabled: true,
  service_url: "",
  grants: { ios: "control", desktop: "control" },
  publish: { lan: true, tailscale: true, cloudflare: true },
  hosts_can_approve: true,
  tunnel: true,
} as const;

function snapshot(
  over: Omit<Partial<AccountTraySnapshot>, "status"> & {
    status?: Partial<AccountTraySnapshot["status"]>;
  } = {},
): AccountTraySnapshot {
  const { status, ...rest } = over;

  return {
    status: {
      linked: false,
      name: "Mini",
      system_name: "Mini",
      safety_code: null,
      link: { kind: "idle" },
      config: { ...CONFIG, grants: { ...CONFIG.grants } },
      ...status,
    },
    approval: { kind: "idle" },
    tunnel: { phase: "off", reason: "not_linked", url: null },
    requests: [],
    online: null,
    notice: null,
    ...rest,
  };
}

function labels(entries: AccountMenuEntry[]): string[] {
  return entries.map((e) => (e.type === "separator" ? "---" : e.label));
}

function find(entries: AccountMenuEntry[], label: string) {
  const entry = entries.find(
    (e) => e.type !== "separator" && e.label === label,
  );
  if (!entry || entry.type === "separator") {
    throw new Error(`no entry "${label}"`);
  }

  return entry;
}

const request: AccountJoinRequest = {
  request_id: "r1",
  kind: "device",
  subject_name: "Douwe's iPhone",
  subject_role: "device",
  subject_kind: "ios",
  status: "pending",
  created_at: 0,
  expires_at: 0,
};

const linked = { linked: true, safety_code: "ABCD-EFGH" };

describe("accountMenuModel", () => {
  it("offers linking when not linked", () => {
    const menu = accountMenuModel(snapshot());
    expect(labels(menu)).toEqual(["Link to Argus Account…"]);
    expect(find(menu, "Link to Argus Account…").action).toEqual({
      kind: "link_start",
    });
  });

  it("shows the code and where to enter it while waiting for a claim", () => {
    const menu = accountMenuModel(
      snapshot({
        status: {
          link: {
            kind: "awaiting_claim",
            user_code: "WDJB-MJHT",
            verification_uri: "https://houwert.dev/argus/link",
            verification_uri_complete:
              "https://houwert.dev/argus/link?code=WDJB-MJHT",
            expires_at: 0,
          },
        },
      }),
    );
    expect(labels(menu)[0]).toBe("Enter WDJB-MJHT at houwert.dev/argus/link");
    expect(find(menu, "Open houwert.dev/argus/link").action).toEqual({
      kind: "link_open",
      url: "https://houwert.dev/argus/link?code=WDJB-MJHT",
    });
    expect(find(menu, "Cancel Linking").action).toEqual({
      kind: "link_cancel",
    });
  });

  it("asks for the six-digit comparison before linking", () => {
    const menu = accountMenuModel(
      snapshot({
        status: {
          link: {
            kind: "awaiting_sas",
            sas: "482093",
            approver_name: "iPhone",
          },
        },
      }),
    );
    expect(labels(menu)).toContain("Confirm this matches: 482 093");
    expect(find(menu, "Codes Match — Link").action).toEqual({
      kind: "link_confirm",
      match: true,
    });
    expect(find(menu, "Codes Differ — Cancel").action).toEqual({
      kind: "link_confirm",
      match: false,
    });
  });

  it("shows status, presence and the tunnel address when linked", () => {
    const menu = accountMenuModel(
      snapshot({
        status: linked,
        online: true,
        tunnel: {
          phase: "running",
          reason: null,
          url: "wss://abc.tunnel.houwert.dev",
        },
      }),
    );
    expect(labels(menu).slice(0, 3)).toEqual([
      'Argus Account: linked as "Mini"',
      "Online",
      "Managed tunnel: abc.tunnel.houwert.dev",
    ]);
    const settings = find(menu, "Argus Account").submenu ?? [];
    expect(find(settings, "Managed Tunnel")).toMatchObject({
      checked: true,
      action: { kind: "tunnel", on: false },
    });
    expect(find(settings, "Unlink…").action).toEqual({ kind: "unlink" });
    expect(labels(settings)).not.toContain("Use System Name (Mini)");
  });

  it("offers the system name back once renamed", () => {
    const menu = accountMenuModel(
      snapshot({ status: { ...linked, name: "Build box" } }),
    );
    const settings = find(menu, "Argus Account").submenu ?? [];
    expect(find(settings, "Use System Name (Mini)").action).toEqual({
      kind: "rename_default",
    });
  });

  it("lists who is waiting to join with approve and deny", () => {
    const menu = accountMenuModel(
      snapshot({ status: linked, requests: [request] }),
    );
    const waiting = find(menu, "Waiting to join (1)");
    const row = find(waiting.submenu ?? [], "Douwe's iPhone (device)");
    expect(
      (row.submenu ?? []).map((e) => e.type !== "separator" && e.action),
    ).toEqual([
      { kind: "approve", requestId: "r1" },
      { kind: "deny", requestId: "r1" },
    ]);
  });

  it("honours approving being turned off on this computer", () => {
    const menu = accountMenuModel(
      snapshot({
        status: { ...linked, config: { ...CONFIG, hosts_can_approve: false } },
        requests: [request],
      }),
    );
    const entry = find(menu, "Waiting to join (1) — approving here is off");
    expect(entry.enabled).toBe(false);
    expect(entry.submenu).toBeUndefined();
  });

  it("asks for the comparison while approving", () => {
    const menu = accountMenuModel(
      snapshot({
        status: linked,
        requests: [request],
        approval: {
          kind: "awaiting_sas",
          request_id: "r1",
          sas: "123456",
          subject_name: "Douwe's iPhone",
          subject_role: "device",
        },
      }),
    );
    expect(labels(menu)).toContain("Confirm this matches: 123 456");
    expect(find(menu, "Codes Differ — Deny").action).toEqual({
      kind: "approval_confirm",
      match: false,
    });
    expect(find(menu, "Waiting to join (1)").enabled).toBe(false);
  });

  it("puts a failed action on top until dismissed", () => {
    const menu = accountMenuModel(snapshot({ notice: "That request is gone" }));
    expect(labels(menu).slice(0, 2)).toEqual([
      "That request is gone",
      "Dismiss",
    ]);
  });
});
