import type { PushConfig } from "../deviceStore";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  apnsProviderToken,
  buildApnsBody,
  isApnsConfigured,
  isApnsTokenDead,
  resetApnsToken,
} from "./apns";
import { isFcmConfigured, isFcmTokenDead, parseServiceAccount } from "./fcm";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function config(overrides: Partial<PushConfig> = {}): PushConfig {
  return {
    enabled: true,
    apns_key_p8: P8,
    apns_key_id: "ABC123DEFG",
    apns_team_id: "TEAM123456",
    apns_bundle_id: "dev.houwert.argus.remote",
    fcm_service_account: "",
    vapid_private_pem: "",
    vapid_public: "",
    vapid_subject: "mailto:argus@localhost",
    ...overrides,
  };
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(
      segment.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString(),
  ) as Record<string, unknown>;
}

describe("apnsProviderToken", () => {
  beforeEach(() => resetApnsToken());

  it("mints a verifiable ES256 JWT naming the key and team", () => {
    const jwt = apnsProviderToken(config(), 1_700_000_000_000);
    const [header, claims, signature] = jwt.split(".");

    expect(decodeSegment(header)).toEqual({
      alg: "ES256",
      kid: "ABC123DEFG",
      typ: "JWT",
    });
    expect(decodeSegment(claims)).toEqual({
      iss: "TEAM123456",
      iat: 1_700_000_000,
    });
    // Apple requires the raw r||s JOSE encoding, not DER.
    const valid = cryptoVerify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
    );
    expect(valid).toBe(true);
  });

  it("reuses the token inside the refresh window and re-signs after it", () => {
    const start = 1_700_000_000_000;
    const first = apnsProviderToken(config(), start);

    expect(apnsProviderToken(config(), start + 60_000)).toBe(first);
    expect(apnsProviderToken(config(), start + 60 * 60_000)).not.toBe(first);
  });

  it("re-signs when the credentials change", () => {
    const start = 1_700_000_000_000;
    const first = apnsProviderToken(config(), start);

    expect(
      apnsProviderToken(config({ apns_key_id: "OTHER1234" }), start),
    ).not.toBe(first);
  });
});

describe("provider configuration", () => {
  it("needs every APNs field before it will send", () => {
    expect(isApnsConfigured(config())).toBe(true);
    expect(isApnsConfigured(config({ apns_bundle_id: "  " }))).toBe(false);
    expect(isApnsConfigured(config({ apns_key_p8: "" }))).toBe(false);
  });

  it("accepts a service account only when it can actually authenticate", () => {
    const account = JSON.stringify({
      client_email: "push@argus.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----",
      project_id: "argus",
    });

    expect(isFcmConfigured(config({ fcm_service_account: account }))).toBe(
      true,
    );
    expect(isFcmConfigured(config({ fcm_service_account: "not json" }))).toBe(
      false,
    );
    expect(
      isFcmConfigured(
        config({
          fcm_service_account: JSON.stringify({ project_id: "argus" }),
        }),
      ),
    ).toBe(false);
    expect(parseServiceAccount("")).toBeNull();
  });
});

describe("dead-token detection", () => {
  it("treats provider rejections that mean 'forget this token' as terminal", () => {
    expect(isApnsTokenDead("Unregistered")).toBe(true);
    expect(isApnsTokenDead("BadDeviceToken")).toBe(true);
    expect(isApnsTokenDead("TooManyRequests")).toBe(false);
    expect(isFcmTokenDead("UNREGISTERED")).toBe(true);
    expect(isFcmTokenDead("UNAVAILABLE")).toBe(false);
  });
});

describe("buildApnsBody", () => {
  const base = {
    title: "Project agent needs approval",
    body: "session - Agent requested Bash",
    data: { agentId: "a1", toolUseId: "t1", kind: "permission" },
  };

  it("names the category so iOS renders the registered buttons", () => {
    const parsed = JSON.parse(
      buildApnsBody({ ...base, category: "argus.permission" }),
    ) as { aps: { category?: string } };

    expect(parsed.aps.category).toBe("argus.permission");
  });

  it("omits the category when there are no quick actions", () => {
    const parsed = JSON.parse(buildApnsBody(base)) as {
      aps: Record<string, unknown>;
    };

    expect(parsed.aps.category).toBeUndefined();
  });

  it("keeps custom keys beside aps, where expo-notifications reads them", () => {
    const parsed = JSON.parse(buildApnsBody(base)) as Record<string, unknown>;

    expect(parsed.agentId).toBe("a1");
    expect(parsed.toolUseId).toBe("t1");
  });
});
