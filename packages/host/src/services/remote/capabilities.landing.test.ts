/**
 * The methods that land work: committing, pushing and merging a session, and
 * the pull-request family on top of them.
 *
 * These write to a repo or speak on GitHub under the user's account, so the
 * tier and the scope rule are the whole safety story — asserted here rather
 * than read off the source.
 */

import type { RemoteMethod } from "@argus/remote-protocol";
import { METHOD_SCOPE, REMOTE_METHODS } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";

const tier = (method: RemoteMethod) => REMOTE_METHODS[method];

const WRITES = [
  "sessions.commit",
  "sessions.push",
  "sessions.merge_base",
  "github.create_pull_request",
  "github.merge_pull_request",
  "github.comment_pull_request",
] as const satisfies readonly RemoteMethod[];

const READS = [
  "sessions.merge_blockers",
  "github.pull_requests",
  "github.pull_request",
] as const satisfies readonly RemoteMethod[];

describe("landing work over the wire", () => {
  it("writes at control and reads at monitor", () => {
    for (const method of WRITES) {
      expect(tier(method)).toBe("control");
    }
    for (const method of READS) {
      expect(tier(method)).toBe("monitor");
    }
  });

  /** A huddle guest reviews the agent it was handed; it never ships. */
  it("denies every write to a scoped grant", () => {
    for (const method of WRITES) {
      expect(METHOD_SCOPE[method].kind).toBe("denied");
    }
  });

  /**
   * Reading the blockers is reading the session the guest already has, so it
   * resolves through that session rather than being refused outright — the
   * pull-request reads have no session to resolve through and are denied.
   */
  it("scopes the reads to what a guest can already see", () => {
    expect(METHOD_SCOPE["sessions.merge_blockers"].kind).toBe("session");
    expect(METHOD_SCOPE["github.pull_requests"].kind).toBe("denied");
    expect(METHOD_SCOPE["github.pull_request"].kind).toBe("denied");
  });
});
