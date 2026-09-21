import type { FixtureResolver, FixtureScenario } from "../types";
import { AGENTS, BASE_CHANNELS, BASE_STORAGE, NOW } from "./aurora";

const MINUTES = 60_000;

function device(
  id: string,
  label: string,
  capabilities: string[],
  lastSeenMinutes: number | null,
  push: boolean,
) {
  return {
    capabilities,
    created_at: NOW - 21 * 24 * 60 * MINUTES,
    dev_static_pub: `pub_${id}`,
    device_id: id,
    label,
    last_seen:
      lastSeenMinutes === null ? null : NOW - lastSeenMinutes * MINUTES,
    push: push
      ? { service: "apns", token: `tok_${id}`, updated_at: NOW - 60 * MINUTES }
      : null,
  };
}

const DEVICES = [
  device("dev_iphone", "Douwe's iPhone", ["control"], 0, true),
  device("dev_ipad", "iPad Pro", [], 26, true),
  device("dev_mini", "Studio mini", ["control", "admin"], 1, false),
];

const STATUS = {
  cloudflareEnabled: false,
  connectedDeviceIds: ["dev_iphone", "dev_mini"],
  devices: DEVICES,
  enabled: true,
  endpoints: [
    { kind: "lan", priority: 0, url: "http://192.168.1.24:47615" },
    {
      kind: "tailscale",
      priority: 1,
      url: "https://aurora-mbp.tail9c2f.ts.net",
    },
  ],
  hasTunnelToken: false,
  lanUrl: "http://192.168.1.24:47615",
  lanWebEnabled: true,
  notifyWhenFocused: false,
  publicUrl: "https://aurora-mbp.tail9c2f.ts.net",
  tailscaleEnabled: true,
  tunnelMode: "quick",
  tunnels: {
    cloudflare: {
      error: null,
      publicUrl: null,
      reachable: null,
      status: "stopped",
    },
    tailscale: {
      error: null,
      publicUrl: "https://aurora-mbp.tail9c2f.ts.net",
      reachable: true,
      status: "running",
    },
  },
};

/**
 * Remote access, configured and live: two ways in, three paired devices, one
 * of them another Mac holding the admin grant.
 */
export const remote: FixtureScenario = {
  id: "remote",
  route: "/",
  settingsSection: "remote-access",
  storage: BASE_STORAGE,
  events: AGENTS.map((a) => ({ channel: "agent:started", payload: a })),
  // The paired-device list is below the fold in the dialog, and it is the part
  // that proves the point, so the recording scrolls down to it.
  posterBeat: 1,
  beats: [
    { holdSeconds: 3.4 },
    { scrollTo: 820, holdSeconds: 4.5 },
    { scrollTo: 1640, holdSeconds: 4 },
  ],
  channels: {
    ...BASE_CHANNELS,
    list_agents: ((args) =>
      AGENTS.filter((a) => a.session_id === args.sessionId)) as FixtureResolver,
    remote_get_status: STATUS,
    remote_get_push_config: {
      enabled: true,
      relayUrl: "https://push.houwert.dev",
      vapidSubject: "mailto:you@example.com",
      webPushConfigured: true,
    },
  },
};
