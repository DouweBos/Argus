import type { PairingClientInfo } from "@argus/remote-protocol";
import { PairingPayload, PairingGrant } from "@argus/remote-protocol";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { derivePairingPsk, deriveSas } from "./derive";
import { generateKeypair, NoiseHandshake } from "./noise";

// Real PairingSession + local gateway server; stub persistence + identity +
// the gateway's service-layer/broadcast imports.
const saved: unknown[] = [];
vi.mock("./deviceStore", () => ({
  getDesktopIdentity: async () => ({ priv: IDENTITY.priv, pub: IDENTITY.pub }),
  saveDevice: async (d: unknown) => {
    saved.push(d);
  },
  findDeviceByStaticKey: async () => null,
  capabilitiesFor: (g: { control?: boolean; admin?: boolean }) => [
    "monitor",
    ...(g.control || g.admin ? ["control"] : []),
    ...(g.admin ? ["admin"] : []),
  ],
}));
vi.mock("@argus/host/bus", () => ({
  addHostEventSink: () => () => {},
  emitHostEvent: () => {},
}));
vi.mock("../../state", () => ({
  appState: { agents: new Map(), agentSnapshots: new Map() },
}));
vi.mock("../agent/agentService", () => ({
  listAgents: () => [],
  respondToPermission: () => {},
}));
vi.mock("../mcp/projectDiscovery", () => ({
  collectAllProjects: () => [],
}));
vi.mock("../session/manager", () => ({ listSessions: async () => [] }));
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: async () => "",
  getSessionFullDiff: async () => "",
}));

const IDENTITY = generateKeypair();
const dec = new TextDecoder();

const { startLocalGateway, stopLocalGateway } =
  await import("./localGatewayServer");
const { startPairing, confirmPairing, cancelPairing } =
  await import("./pairing");

let url: string;

/** Client half of pairing: IKpsk1 initiator over the /pair socket. */
class PairingClient {
  private ws!: WebSocket;
  private hs!: NoiseHandshake;
  private session: ReturnType<NoiseHandshake["session"]> | null = null;
  sas: string | null = null;
  grant: PairingGrant | null = null;
  private onGrant!: () => void;
  readonly grantReceived: Promise<void>;

  constructor(
    private readonly payload: PairingPayload,
    private readonly psk: Uint8Array,
    private readonly identity: Uint8Array = new Uint8Array(0),
    private readonly clientStatic = generateKeypair(),
  ) {
    this.grantReceived = new Promise((r) => (this.onGrant = r));
  }

  connect(): void {
    this.ws = new WebSocket(`${this.payload.url}/pair`);
    this.ws.binaryType = "arraybuffer";
    this.ws.on("open", () => {
      this.hs = new NoiseHandshake({
        role: "initiator",
        staticKey: this.clientStatic,
        remoteStatic: new Uint8Array(
          Buffer.from(this.payload.ds_pub, "base64url"),
        ),
        psk: this.psk,
      });
      this.ws.send(this.hs.writeMessage(this.identity));
    });
    this.ws.on("message", (raw: WebSocket.RawData) => {
      const bytes = new Uint8Array(raw as Buffer);
      if (!this.session) {
        try {
          this.hs.readMessage(bytes);
          this.session = this.hs.session();
          this.sas = deriveSas(this.hs.handshakeHash());
        } catch {
          /* wrong psk — stays null */
        }
      } else {
        this.grant = PairingGrant.parse(
          JSON.parse(dec.decode(this.session.decrypt(bytes))),
        );
        this.onGrant();
      }
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe("device pairing (IKpsk1 over local gateway)", () => {
  beforeAll(async () => {
    const port = await startLocalGateway(0, {
      priv: IDENTITY.priv,
      pub: IDENTITY.pub,
    });
    url = `ws://127.0.0.1:${port}`;
  });

  afterAll(() => stopLocalGateway());

  it("enrolls a device: SAS matches and the grant arrives on confirm", async () => {
    saved.length = 0;
    let desktopSas = "";
    const start = await startPairing(url, {
      onSas: (s) => (desktopSas = s),
      onPaired: () => {},
      onError: () => {},
    });
    const payload = PairingPayload.parse(JSON.parse(start.qrPayload));
    const psk = derivePairingPsk(
      new Uint8Array(Buffer.from(payload.pairing_secret, "base64url")),
    );

    const client = new PairingClient(payload, psk);
    client.connect();
    await vi.waitFor(() => expect(client.sas).not.toBeNull());
    expect(client.sas).toBe(desktopSas);

    await confirmPairing();
    await client.grantReceived;
    expect(client.grant?.capabilities).toEqual(["monitor"]);
    expect(saved).toHaveLength(1);

    client.close();
  });

  it("a wrong pairing secret cannot complete the handshake (MITM)", async () => {
    saved.length = 0;
    const start = await startPairing(url, {
      onSas: () => {},
      onPaired: () => {},
      onError: () => {},
    });
    const payload = PairingPayload.parse(JSON.parse(start.qrPayload));
    const wrongPsk = derivePairingPsk(new Uint8Array(32).fill(9));

    const client = new PairingClient(payload, wrongPsk);
    client.connect();
    const outcome = await Promise.race([
      client.grantReceived.then(() => "grant"),
      new Promise((r) => setTimeout(() => r("timeout"), 400)),
    ]);
    expect(outcome).toBe("timeout");
    expect(client.sas).toBeNull();
    expect(saved).toHaveLength(0);

    cancelPairing();
    client.close();
  });

  it("surfaces what the client says it is, for the confirm screen", async () => {
    saved.length = 0;
    let client: PairingClientInfo | null = null;
    const start = await startPairing(url, {
      onSas: (_sas, info) => (client = info),
      onPaired: () => {},
      onError: () => {},
    });
    const payload = PairingPayload.parse(JSON.parse(start.qrPayload));
    const psk = derivePairingPsk(
      new Uint8Array(Buffer.from(payload.pairing_secret, "base64url")),
    );

    const device = new PairingClient(
      payload,
      psk,
      new TextEncoder().encode(
        JSON.stringify({
          product: "Argus Remote",
          kind: "mobile",
          device: "iPhone 17 Pro",
        }),
      ),
    );
    device.connect();
    await vi.waitFor(() => expect(client).not.toBeNull());
    expect(client).toMatchObject({ kind: "mobile", product: "Argus Remote" });

    cancelPairing();
    device.close();
  });

  it("is unbothered by a client that says nothing, or nonsense", async () => {
    for (const identity of [
      new Uint8Array(0),
      new TextEncoder().encode("{not json"),
      new TextEncoder().encode(JSON.stringify({ kind: "toaster" })),
    ]) {
      saved.length = 0;
      let client: PairingClientInfo | null = null;
      let sas = "";
      const start = await startPairing(url, {
        onSas: (s, info) => {
          sas = s;
          client = info;
        },
        onPaired: () => {},
        onError: () => {},
      });
      const payload = PairingPayload.parse(JSON.parse(start.qrPayload));
      const psk = derivePairingPsk(
        new Uint8Array(Buffer.from(payload.pairing_secret, "base64url")),
      );

      const device = new PairingClient(payload, psk, identity);
      device.connect();
      await vi.waitFor(() => expect(sas).not.toBe(""));
      expect(client).toBeNull();

      cancelPairing();
      device.close();
    }
  });
});
