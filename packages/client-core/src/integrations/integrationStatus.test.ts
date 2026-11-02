import type { IntegrationStatus } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { integrationView } from "./integrationStatus";

const base: IntegrationStatus = {
  id: "linear",
  connected: true,
  method: "oauth",
  account: {
    name: "Ada Lovelace",
    email: "ada@example.com",
    workspace: "Acme",
  },
  needsReauth: false,
  oauthAvailable: true,
};

describe("integrationView", () => {
  it("names the account and workspace", () => {
    expect(integrationView(base)).toMatchObject({
      name: "Linear",
      stateLabel: "Connected",
      tone: "success",
      account: "Ada Lovelace · Acme",
    });
  });

  it("asks to reconnect a lapsed credential", () => {
    const view = integrationView({ ...base, needsReauth: true });
    expect(view.stateLabel).toBe("Reconnect");
    expect(view.tone).toBe("warning");
  });

  it("shows no account when not connected", () => {
    const view = integrationView({
      ...base,
      id: "figma",
      connected: false,
      account: null,
    });
    expect(view).toMatchObject({
      name: "Figma",
      stateLabel: "Not connected",
      tone: "neutral",
      account: null,
    });
  });
});
