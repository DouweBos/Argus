import type { LogEntry } from "./schema";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountApprovals } from "./approvals";

const DIR = path.resolve(__dirname, "fixtures");

interface Fixture {
  name: string;
  entries: LogEntry[];
  admission?: {
    member_id: string;
    request_id: string;
    sas_commit: string;
    admitted: boolean;
  };
}

const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as Fixture)
  .filter((f) => Array.isArray(f.entries) && f.admission);

describe("accountApprovals", () => {
  it("covers the join fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(1);
  });

  const admitted = fixtures.filter((f) => f.admission!.admitted);
  const refused = fixtures.filter((f) => !f.admission!.admitted);

  it.each(admitted.map((f) => [f.name, f] as const))(
    "recomputes the code %s was approved with",
    (_, fixture) => {
      const admission = fixture.admission!;
      const approval = accountApprovals(fixture.entries)[admission.member_id];
      expect(approval?.request_id).toBe(admission.request_id);
      expect(approval?.sas.commit).toBe(admission.sas_commit);
      expect(approval?.sas.sas).toMatch(/^\d{6}$/);
    },
  );

  it.each(refused.map((f) => [f.name, f] as const))(
    "never offers the refused commit in %s as a code to check",
    (_, fixture) => {
      const admission = fixture.admission!;
      const approval = accountApprovals(fixture.entries)[admission.member_id];
      expect(approval?.sas.commit ?? null).not.toBe(admission.sas_commit);
    },
  );

  it("ignores members added without a request", () => {
    const valid = JSON.parse(
      readFileSync(path.join(DIR, "valid_chain.json"), "utf8"),
    ) as Fixture;
    const approvals = accountApprovals(valid.entries);
    for (const approval of Object.values(approvals)) {
      expect(approval.request_id).not.toBe("");
    }
  });
});
