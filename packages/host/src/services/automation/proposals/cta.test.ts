import type { ProposalCta } from "./models";
import { describe, expect, it } from "vitest";
import { resolveCta } from "./cta";

/** The kinds that do not apply are null, so assertions stay exhaustive. */
function cta(patch: Partial<ProposalCta>): ProposalCta {
  return {
    kind: "open_url",
    label: "",
    url: null,
    branch: null,
    force: false,
    session_id: null,
    ...patch,
  };
}

const SOURCE = {
  external_id: "acme/app#412",
  source_id: "github",
  url: "https://github.com/acme/app/pull/412",
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
    ).toEqual(
      cta({ kind: "open_url", label: "Open PR #6478", url: "https://x/6478" }),
    );
  });

  it("falls back to the source url when open_url names none", () => {
    expect(
      resolveCta(
        { kind: "open_url", label: "Review it" },
        { recommended_action: "review", repo_root: null, source_ref: SOURCE },
      ),
    ).toEqual(cta({ kind: "open_url", label: "Review it", url: SOURCE.url }));
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
    ).toEqual(cta({ kind: "start_session", label: "Start" }));
  });

  it("derives the source link for everything else", () => {
    expect(
      resolveCta(undefined, {
        recommended_action: "review",
        repo_root: "/repo",
        source_ref: SOURCE,
      }),
    ).toEqual(
      cta({
        kind: "open_url",
        label: "Open acme/app#412",
        url: SOURCE.url,
      }),
    );
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

  it("carries the branch and the -D a cleanup proposal argued for", () => {
    expect(
      resolveCta(
        {
          kind: "delete_branch",
          label: "Delete the branch",
          branch: "douwe/refactor",
          force: true,
        },
        { recommended_action: "review", repo_root: "/repo", source_ref: null },
      ),
    ).toEqual(
      cta({
        kind: "delete_branch",
        label: "Delete the branch",
        branch: "douwe/refactor",
        force: true,
      }),
    );
  });

  it("drops a cleanup CTA that names nothing to delete", () => {
    expect(
      resolveCta(
        { kind: "delete_branch", label: "Delete the branch" },
        { recommended_action: "review", repo_root: "/repo", source_ref: null },
      ),
    ).toBeNull();
    expect(
      resolveCta(
        { kind: "delete_session", label: "Retire it" },
        { recommended_action: "review", repo_root: "/repo", source_ref: null },
      ),
    ).toBeNull();
  });

  it("keeps a delete_session pointed at its session", () => {
    expect(
      resolveCta(
        { kind: "delete_session", label: "Retire it", session_id: "s-1" },
        { recommended_action: "review", repo_root: null, source_ref: null },
      ),
    ).toEqual(
      cta({ kind: "delete_session", label: "Retire it", session_id: "s-1" }),
    );
  });
});
