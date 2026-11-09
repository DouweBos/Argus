import { describe, expect, it } from "vitest";
import { TELEMETRY_RUNNERS } from "../../../../../telemetryEvents";
import { KNOWN_RUNNER_IDS } from "../../../../session/argusConfigNormalize";
import { listRunners } from "../../../registry";
import { ACP_PRESETS } from ".";

describe("built-in runners", () => {
  it("are all known to config validation and telemetry", () => {
    const builtIns = listRunners().filter((r) => !r.isCustom);
    const ids = builtIns.map((r) => r.id);
    expect(ids.filter((id) => !KNOWN_RUNNER_IDS.has(id))).toEqual([]);
    expect(
      ids.filter(
        (id) => !(TELEMETRY_RUNNERS as readonly string[]).includes(id),
      ),
    ).toEqual([]);
  });

  it("each ACP preset has a unique id, a binary and install and sign-in hints", () => {
    const ids = ACP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const incomplete = ACP_PRESETS.filter(
      (p) => p.bins.length === 0 || !p.installHint || !p.loginHint,
    );
    expect(incomplete.map((p) => p.id)).toEqual([]);
  });
});
