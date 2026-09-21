import { describe, expect, it } from "vitest";
import { resolveCta } from "./cta";

const SOURCE = {
  external_id: "plexinc/app#412",
  source_id: "github",
  url: "https://github.com/plexinc/app/pull/412",
};

describe("resolveCta", () => {
  it("keeps what the run asked for", () => {
    expect(
      resolveCta(
        { kind: "open_url", label: "Open PR #6478", url: "https://x/6478" },
        {
          recommended_action: "review",
          repo_root: "/repo",
          source_ref: SOURCE,
        },
      ),
    ).toEqual({
      kind: "open_url",
      label: "Open PR #6478",
      url: "https://x/6478",
    });
  });

  it("falls back to the source url when open_url names none", () => {
    expect(
      resolveCta(
        { kind: "open_url", label: "Review it" },
        { recommended_action: "review", repo_root: null, source_ref: SOURCE },
      ),
    ).toEqual({ kind: "open_url", label: "Review it", url: SOURCE.url });
  });

  it("drops an open_url with nowhere to go", () => {
    expect(
      resolveCta(
        { kind: "open_url", label: "Review it" },
        { recommended_action: "review", repo_root: null, source_ref: null },
      ),
    ).toBeNull();
  });

  it("drops a start_session with no project to work in", () => {
    expect(
      resolveCta(
        { kind: "start_session", label: "Start" },
        {
          recommended_action: "start_session",
          repo_root: null,
          source_ref: SOURCE,
        },
      ),
    ).toBeNull();
  });

  it("derives Start for actionable work when the run said nothing", () => {
    expect(
      resolveCta(null, {
        recommended_action: "start_session",
        repo_root: "/repo",
        source_ref: null,
      }),
    ).toEqual({ kind: "start_session", label: "Start", url: null });
  });

  it("derives the source link for everything else", () => {
    expect(
      resolveCta(undefined, {
        recommended_action: "review",
        repo_root: "/repo",
        source_ref: SOURCE,
      }),
    ).toEqual({
      kind: "open_url",
      label: "Open plexinc/app#412",
      url: SOURCE.url,
    });
  });

  it("leaves a proposal with nothing to act on buttonless", () => {
    expect(
      resolveCta(undefined, {
        recommended_action: "ignore",
        repo_root: "/repo",
        source_ref: null,
      }),
    ).toBeNull();
  });
});
