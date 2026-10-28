/**
 * An in-memory stand-in for the account service, for host tests. It checks
 * host request signatures and log CAS like the real one, and lets a test play
 * the phone (claim, approve, append) without Clerk.
 */

import type {
  DeviceMember,
  HostMember,
  LogEntry,
  LogState,
} from "@argus/remote-protocol";
import {
  entryHash,
  requestSigningBytes,
  verifyB64,
  verifyLog,
} from "@argus/remote-protocol";

interface Request {
  id: string;
  code: string;
  kind: "computer" | "device" | "host";
  subject: {
    host?: HostMember;
    device?: DeviceMember;
    proofs: Record<string, string>;
  };
  status: string;
  accountId: string | null;
  approver: { id: string; sign_pub: string } | null;
  head: { seq: number; hash: string } | null;
  throughSeq: number | null;
}

const PREFIX = "/argus/account/v1";

export class FakeAccountService {
  readonly baseUrl = `https://fake.test${PREFIX}`;
  accountId = "acct-test";
  epoch = 0;
  entries: LogEntry[] = [];
  requests = new Map<string, Request>();
  presence = new Map<
    string,
    { presence_body: string; presence_sig: string; last_seen: number }
  >();
  /** Requests whose signature didn't verify. */
  rejectedSignatures = 0;
  /** Push keys devices sealed, per host id (`GET /host/push-keys`). */
  pushKeys = new Map<
    string,
    {
      device_id: string;
      service: "apns" | "fcm";
      environment: "production" | "sandbox";
      sealed: string;
    }[]
  >();
  /** Every `POST /push/send`, with the host that sent it. */
  pushSent: {
    host_id: string;
    device_id: string;
    sealed: string;
    collapse_id?: string;
  }[] = [];
  /** Managed tunnels, per host id (`POST /host/tunnel`). */
  tunnels = new Map<
    string,
    { hostname: string; tunnel_id: string; token: string; port: number }
  >();
  /** Off: `POST /host/tunnel` answers 503 like a service with no API token. */
  tunnelsEnabled = true;
  /** Every `POST /host/tunnel`, and every `DELETE`, by host id. */
  tunnelRequests: string[] = [];
  tunnelReleases: string[] = [];
  private nextId = 1;

  /** Tokens the next `POST /host/tunnel` calls hand out, in order. */
  tunnelTokens: string[] = [];

  state(): LogState | null {
    const result = verifyLog(this.entries);

    return result.state;
  }

  head(): { seq: number; hash: string } | null {
    const last = this.entries.at(-1);

    return last
      ? { seq: this.entries.length - 1, hash: entryHash(last.body) }
      : null;
  }

  /** A signed-in app asking to join (`POST /join`), already on this account. */
  addDeviceJoin(device: DeviceMember, proof: string): Request {
    const id = `req-${this.nextId++}`;
    const request: Request = {
      id,
      code: "",
      kind: "device",
      subject: { device, proofs: { [device.id]: proof } },
      status: "claimed",
      accountId: this.accountId,
      approver: null,
      head: null,
      throughSeq: null,
    };
    this.requests.set(id, request);

    return request;
  }

  /** The phone/page claiming a code for this account. */
  claim(code: string): Request {
    const request = [...this.requests.values()].find((r) => r.code === code);
    if (!request) {
      throw new Error("unknown code");
    }
    request.status = "claimed";
    request.accountId = this.accountId;

    return request;
  }

  setApprover(requestId: string, approver: { id: string; sign_pub: string }) {
    const request = this.requests.get(requestId)!;
    request.status = "approving";
    request.approver = approver;
    request.head = this.head();

    return request.head!;
  }

  /** Append like `POST /log`: CAS on the head, then the verifier. */
  append(entries: LogEntry[]): number {
    const head = this.head();
    const first = JSON.parse(entries[0].body) as { seq: number; prev: string };
    if (first.seq !== (head ? head.seq + 1 : 0)) {
      return 409;
    }
    const result = verifyLog([...this.entries, ...entries]);
    if (!result.ok) {
      return 422;
    }
    this.entries.push(...entries);
    for (const entry of entries) {
      const body = JSON.parse(entry.body) as {
        type: string;
        request_id?: string;
      };
      const request = body.request_id
        ? this.requests.get(body.request_id)
        : undefined;
      if (request && body.type.startsWith("add_")) {
        request.status = "approved";
        request.throughSeq = this.entries.length - 1;
      }
      if (body.type === "genesis") {
        for (const r of this.requests.values()) {
          if (
            r.subject.host?.sign_pub === JSON.parse(entry.body).member.sign_pub
          ) {
            r.status = "approved";
            r.throughSeq = this.entries.length - 1;
          }
        }
      }
    }

    return 201;
  }

  private authorized(
    req: { method: string; path: string; body: string },
    headers: Headers,
  ): string | null {
    const ts = Number(headers.get("x-argus-ts"));
    const sig = headers.get("x-argus-sig") ?? "";
    const memberId = headers.get("x-argus-member");
    const state = this.state();
    const member = memberId ? state?.members[memberId] : undefined;
    const memberKey = member?.live ? member.member.sign_pub : null;
    const key = memberId ? memberKey : headers.get("x-argus-key");
    if (
      !key ||
      Math.abs(Date.now() - ts) > 5 * 60_000 ||
      !verifyB64(
        requestSigningBytes(req.method, req.path, ts, req.body),
        sig,
        key,
      )
    ) {
      this.rejectedSignatures += 1;

      return null;
    }

    return key;
  }

  readonly fetch = async (
    input: globalThis.Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      input instanceof globalThis.Request ? input.url : input,
    );
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers);
    const key = this.authorized(
      { method, path: url.pathname + url.search, body },
      headers,
    );
    if (!key) {
      return json({ error: "unauthorized" }, 401);
    }
    const route = url.pathname.slice(PREFIX.length);
    const payload = body ? (JSON.parse(body) as Record<string, unknown>) : {};

    if (method === "POST" && route === "/link/start") {
      const id = `req-${this.nextId++}`;
      const code = `CODE-${String(this.nextId).padStart(4, "0")}`;
      const subject = payload.subject as Request["subject"];
      this.requests.set(id, {
        id,
        code,
        kind: subject.device ? "computer" : "host",
        subject: {
          ...(payload.subject as Request["subject"]),
          proofs: payload.proofs as Record<string, string>,
        },
        status: "pending",
        accountId: null,
        approver: null,
        head: null,
        throughSeq: null,
      });

      return json({
        request_id: id,
        user_code: code,
        verification_uri: "https://fake.test/argus/link",
        verification_uri_complete: `https://fake.test/argus/link?code=${code}`,
        expires_in: 600,
        interval: 0,
      });
    }
    const link = route.match(/^\/link\/([^/]+)$/);
    if (link) {
      const request = this.requests.get(link[1]);
      if (!request || request.subject.host?.sign_pub !== key) {
        return json({ error: "not_found" }, 404);
      }
      if (method === "DELETE") {
        request.status = "denied";

        return new Response(null, { status: 204 });
      }

      return json({
        status: request.status,
        account_empty: this.entries.length === 0,
        ...(request.accountId
          ? { account_id: request.accountId, epoch: this.epoch }
          : {}),
        ...(request.approver ? { approver: request.approver } : {}),
        ...(request.head ? { head: request.head } : {}),
        ...(request.throughSeq !== null
          ? { through_seq: request.throughSeq }
          : {}),
      });
    }
    if (method === "GET" && route === "/log") {
      const after = Number(url.searchParams.get("after") ?? "-1");

      return json({
        epoch: this.epoch,
        entries: this.entries.slice(after + 1),
        next_after: null,
      });
    }
    if (method === "POST" && route === "/log") {
      const status = this.append(payload.entries as LogEntry[]);

      return json(
        status === 201
          ? { head_seq: this.entries.length - 1 }
          : { error: status === 409 ? "conflict" : "invalid_entry" },
        status,
      );
    }
    if (method === "PUT" && route === "/host/presence") {
      const record = payload as { presence_body: string; presence_sig: string };
      const hostId = headers.get("x-argus-member") ?? "";
      this.presence.set(hostId, { ...record, last_seen: Date.now() });

      return new Response(null, { status: 204 });
    }
    if (method === "GET" && route === "/directory") {
      return json({
        hosts: [...this.presence.entries()].map(([host_id, p]) => ({
          host_id,
          ...p,
        })),
      });
    }
    if (method === "GET" && route === "/join") {
      return json({
        requests: [...this.requests.values()]
          .filter((r) => r.status === "claimed" || r.status === "approving")
          .map((r) => ({
            request_id: r.id,
            kind: r.kind,
            subject: r.subject,
            status: r.status,
            created_at: 0,
            expires_at: Date.now() + 600_000,
          })),
      });
    }
    const approver = route.match(/^\/join\/([^/]+)\/approver$/);
    if (method === "POST" && approver) {
      const head = this.setApprover(approver[1], {
        id: String(payload.approver_id),
        sign_pub: key,
      });

      return json({ head });
    }
    if (method === "GET" && route === "/host/push-keys") {
      return json({
        devices: this.pushKeys.get(headers.get("x-argus-member") ?? "") ?? [],
      });
    }
    if (method === "POST" && route === "/push/send") {
      this.pushSent.push({
        host_id: headers.get("x-argus-member") ?? "",
        ...(payload as { device_id: string; sealed: string }),
      });

      return json({ delivered: true, environment: "sandbox" });
    }
    if (
      route === "/host/tunnel" &&
      (method === "POST" || method === "DELETE")
    ) {
      const hostId = headers.get("x-argus-member") ?? "";
      if (method === "DELETE") {
        this.tunnelReleases.push(hostId);
        this.tunnels.delete(hostId);

        return new Response(null, { status: 204 });
      }
      this.tunnelRequests.push(hostId);
      if (!this.tunnelsEnabled) {
        return json({ error: "unavailable" }, 503);
      }
      const existing = this.tunnels.get(hostId);
      const tunnel = {
        hostname: existing?.hostname ?? `argus-${hostId.slice(0, 8)}.fake.test`,
        tunnel_id: existing?.tunnel_id ?? `tun-${this.nextId++}`,
        token:
          this.tunnelTokens.shift() ??
          existing?.token ??
          `token-${this.nextId++}`,
        port: Number(payload.port),
      };
      this.tunnels.set(hostId, tunnel);

      return json({
        hostname: tunnel.hostname,
        url: `wss://${tunnel.hostname}`,
        tunnel_id: tunnel.tunnel_id,
        token: tunnel.token,
        created: !existing,
      });
    }
    const deny = route.match(/^\/join\/([^/]+)\/deny$/);
    if (method === "POST" && deny) {
      const request = this.requests.get(deny[1]);
      if (request) {
        request.status = "denied";
      }

      return new Response(null, { status: 204 });
    }

    return json({ error: "not_found" }, 404);
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
