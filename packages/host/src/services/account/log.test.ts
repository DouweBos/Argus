import type {
  AccountRoot,
  DirectoryRecord,
  LogEntry,
  LogState,
} from "@argus/remote-protocol";
import {
  accountSas,
  admitsMember,
  fromB64,
  liveMembers,
  requestSigningBytes,
  toB64,
  verifyB64,
  verifyLog,
  verifyPresence,
} from "@argus/remote-protocol";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFixtures } from "./fixtureBuilder";

const DIR = path.resolve(
  __dirname,
  "../../../../remote-protocol/src/account/fixtures",
);

interface Fixture {
  name: string;
  pin?: AccountRoot;
  entries: LogEntry[];
  expect:
    | { ok: false; reason: string; index: number }
    | { ok: true; head_seq: number; live_members: string[] };
  admission?: {
    member_id: string;
    request_id: string;
    sas_commit: string;
    admitted: boolean;
  };
  presence?: { record: DirectoryRecord; valid: boolean }[];
}

function read<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(DIR, file), "utf-8")) as T;
}

/** Vectors that aren't log fixtures. */
const VECTORS = new Set([
  "keys.json",
  "sas.json",
  "push_key.json",
  "request_signing.json",
]);

const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".json") && !VECTORS.has(f))
  .map((f) => read<Fixture>(f));
const passing = fixtures.filter((f) => f.expect.ok);
const failing = fixtures.filter((f) => !f.expect.ok);

/** Verify and insist on success, for fixtures that must pass. */
function verified(fixture: Fixture): LogState {
  const result = verifyLog(fixture.entries, { root: fixture.pin ?? null });
  if (!result.ok) {
    throw new Error(`${fixture.name}: ${result.reason} at ${result.index}`);
  }

  return result.state;
}

describe("account log fixtures", () => {
  it("match the generator", () => {
    const generated = JSON.parse(JSON.stringify(buildFixtures())) as Record<
      string,
      unknown
    >;
    const onDisk = Object.fromEntries(
      Object.keys(generated).map((file) => [file, read(file)]),
    );
    expect(onDisk).toEqual(generated);
  });

  it.each(passing)("$name verifies", (fixture) => {
    const state = verified(fixture);
    const expected = fixture.expect as {
      head_seq: number;
      live_members: string[];
    };
    expect(state.head.seq).toBe(expected.head_seq);
    expect(
      liveMembers(state)
        .map((m) => m.id)
        .sort(),
    ).toEqual(expected.live_members);
  });

  it.each(failing)("$name is rejected", (fixture) => {
    const { reason, index } = fixture.expect as {
      reason: string;
      index: number;
    };
    expect(
      verifyLog(fixture.entries, { root: fixture.pin ?? null }),
    ).toMatchObject({
      ok: false,
      reason,
      index,
    });
  });

  it.each(passing.filter((f) => f.admission))(
    "$name admission check",
    (fixture) => {
      const admission = fixture.admission!;
      expect(
        admitsMember(verified(fixture), admission.member_id, {
          request_id: admission.request_id,
          sas_commit: admission.sas_commit,
        }),
      ).toBe(admission.admitted);
    },
  );

  it("verifies presence only from the live host's own key", () => {
    const fixture = fixtures.find((f) => f.name === "valid_chain")!;
    const state = verified(fixture);
    const results = (fixture.presence ?? []).map(
      (p) => verifyPresence(state, p.record) !== null,
    );
    expect(results).toEqual((fixture.presence ?? []).map((p) => p.valid));
  });

  it("verifies incrementally on top of a prior state", () => {
    const fixture = fixtures.find((f) => f.name === "valid_chain")!;
    const first = verified({
      ...fixture,
      entries: fixture.entries.slice(0, 3),
    });
    const rest = verifyLog(fixture.entries.slice(3), { prior: first });
    expect(rest).toMatchObject({
      ok: true,
      state: { head: { seq: fixture.entries.length - 1 } },
    });
  });

  it("signs the shared device request vector", () => {
    const vector = read<{
      sign_pub: string;
      cases: {
        method: string;
        path_and_query: string;
        ts: number;
        body: string;
        message: string;
        sig: string;
      }[];
    }>("request_signing.json");
    for (const c of vector.cases) {
      const message = requestSigningBytes(
        c.method,
        c.path_and_query,
        c.ts,
        c.body,
      );
      expect(toB64(message)).toBe(c.message);
      expect(verifyB64(fromB64(c.message), c.sig, vector.sign_pub)).toBe(true);
    }
  });

  it("derives the shared SAS vector", () => {
    const vectors = read<
      {
        input: Parameters<typeof accountSas>[0];
        sas: string;
        commit: string;
      }[]
    >("sas.json");
    expect(vectors.map((v) => accountSas(v.input))).toEqual(
      vectors.map(({ sas, commit }) => ({ sas, commit })),
    );
  });
});
