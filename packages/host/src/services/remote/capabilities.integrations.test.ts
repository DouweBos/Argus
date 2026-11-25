/**
 * Connecting integrations from a device: a key or Slack token typed on the
 * phone reaches the computer's secret store, never comes back, and is control.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import type * as Registry from "../command/registry";
import type { RemoteMethod } from "@argus/remote-protocol";
import {
  MethodResult,
  METHOD_SCOPE,
  REMOTE_METHODS,
} from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));

const LINEAR = {
  id: "linear" as const,
  connected: true,
  method: "key" as const,
  account: { name: "Ada", email: "ada@example.com", workspace: "Acme" },
  needsReauth: false,
  oauthAvailable: true,
};

vi.mock("../integrations/service", () => ({
  listIntegrations: vi.fn(() => []),
  connectWithKey: vi.fn(async () => LINEAR),
  disconnect: vi.fn(),
  integrationStatus: vi.fn((id: string) => ({
    id,
    connected: false,
    method: null,
    account: null,
    needsReauth: false,
    oauthAvailable: true,
  })),
}));

const SLACK = {
  team_id: "T1",
  configured: true,
  state: "connecting",
  error: null,
  workspace: "Acme",
  bot_name: "argus",
  owner: null,
  claim_code: "123456",
  default_project: null,
  mappings: [],
  allowed_users: [],
  thread_count: 0,
  app: null,
};
const OTHER = {
  ...SLACK,
  team_id: "T2",
  workspace: "Other",
  claim_code: "999",
};

vi.mock("../slack/status", () => ({
  slackOverview: vi.fn(() => ({ workspaces: [OTHER], pending_app: null })),
  remoteSlackStatus: vi.fn(() => ({
    status: { ...OTHER, claim_code: null },
    workspaces: [
      { ...OTHER, claim_code: null },
      { ...SLACK, claim_code: null },
    ],
  })),
}));

vi.mock("../command/registry", async (original) => ({
  ...(await original<typeof Registry>()),
  invokeCommand: vi.fn(async () => ({
    workspaces: [OTHER, SLACK],
    pending_app: null,
  })),
}));

const { dispatch } = await import("./capabilities");
const service = vi.mocked(await import("../integrations/service"));
const registry = vi.mocked(await import("../command/registry"));

function ctx(capabilities: PairedDevice["capabilities"]): GatewayContext {
  return {
    device: {
      device_id: "dev-1",
      label: "Phone",
      dev_static_pub: "",
      capabilities,
      created_at: 0,
      last_seen: null,
    },
    connectionId: "conn-1",
    outstandingPermissions: new Set(),
  };
}

const WRITES = [
  "integrations.connect_key",
  "integrations.disconnect",
  "slack.connect",
  "slack.disconnect",
] as const satisfies readonly RemoteMethod[];

const CONTROL = ctx(["monitor", "control"]);

describe("integrations over the wire", () => {
  beforeEach(() => vi.clearAllMocks());

  it("connects and disconnects at control, and never for a scoped grant", () => {
    for (const method of WRITES) {
      expect(REMOTE_METHODS[method]).toBe("control");
      expect(METHOD_SCOPE[method].kind).toBe("denied");
    }
    expect(REMOTE_METHODS["slack.manifest"]).toBe("monitor");
    expect(METHOD_SCOPE["slack.manifest"].kind).toBe("denied");
  });

  it("refuses every write to a monitor-only device", async () => {
    for (const method of WRITES) {
      await expect(
        dispatch(
          method,
          {
            id: "linear",
            key: "lin_api_x",
            bot_token: "b",
            app_token: "a",
            team_id: "T1",
          },
          ctx(["monitor"]),
        ),
      ).rejects.toThrow(/capability/);
    }
    expect(service.connectWithKey).not.toHaveBeenCalled();
    expect(registry.invokeCommand).not.toHaveBeenCalled();
  });

  it("stores the key on the computer and answers without it", async () => {
    const res = await dispatch(
      "integrations.connect_key",
      { id: "linear", key: "lin_api_secret" },
      CONTROL,
    );

    expect(service.connectWithKey).toHaveBeenCalledWith(
      "linear",
      "lin_api_secret",
    );
    expect(
      MethodResult["integrations.connect_key"].parse(res).integration,
    ).toMatchObject({ id: "linear", connected: true });
    expect(JSON.stringify(res)).not.toContain("lin_api_secret");
  });

  it("turns a rejected key into the service's sentence", async () => {
    service.connectWithKey.mockRejectedValueOnce(
      "Linear didn't accept that key.",
    );

    await expect(
      dispatch(
        "integrations.connect_key",
        { id: "linear", key: "nope" },
        CONTROL,
      ),
    ).rejects.toThrow(/didn't accept that key/);
  });

  it("disconnects and answers the new status", async () => {
    const res = await dispatch(
      "integrations.disconnect",
      { id: "figma" },
      CONTROL,
    );

    expect(service.disconnect).toHaveBeenCalledWith("figma");
    expect(MethodResult["integrations.disconnect"].parse(res)).toMatchObject({
      integration: { id: "figma", connected: false },
    });
  });

  it("connects Slack without echoing either token", async () => {
    const res = await dispatch(
      "slack.connect",
      { bot_token: "xoxb-secret", app_token: "xapp-secret" },
      CONTROL,
    );

    expect(registry.invokeCommand).toHaveBeenCalledWith("slack_connect", {
      botToken: "xoxb-secret",
      appToken: "xapp-secret",
    });
    const parsed = MethodResult["slack.connect"].parse(res);
    expect(parsed.status).toMatchObject({
      team_id: "T1",
      claim_code: "123456",
    });
    expect(parsed.workspaces.map((w) => w.claim_code)).toEqual([
      null,
      "123456",
    ]);
    expect(JSON.stringify(res)).not.toMatch(/xoxb-secret|xapp-secret/);
  });

  it("disconnects one Slack workspace and drops the claim codes", async () => {
    const res = await dispatch("slack.disconnect", { team_id: "T1" }, CONTROL);

    expect(registry.invokeCommand).toHaveBeenCalledWith("slack_disconnect", {
      teamId: "T1",
    });
    const parsed = MethodResult["slack.disconnect"].parse(res);
    expect(parsed.status).toMatchObject({ team_id: "T1", claim_code: null });
    expect(parsed.workspaces.every((w) => w.claim_code === null)).toBe(true);
  });
});
