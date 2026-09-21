import { describe, expect, it } from "vitest";
import { mapComments, type TimelineNode } from "./prDetail";

/**
 * Fixture helpers — keep the test bodies short by factoring out the
 * verbose GraphQL timeline node shape.
 */
function issueComment(overrides: Partial<TimelineNode> = {}): TimelineNode {
  return {
    __typename: "IssueComment",
    id: overrides.id ?? "ic-1",
    body: "",
    bodyHTML: "",
    createdAt: "2025-01-01T00:00:00Z",
    url: "https://example.test/ic",
    author: { login: "alice", avatarUrl: "https://avatar.test/a.png" },
    ...overrides,
  };
}

function review(overrides: Partial<TimelineNode> = {}): TimelineNode {
  return {
    __typename: "PullRequestReview",
    id: overrides.id ?? "r-1",
    body: "",
    bodyHTML: "",
    state: "COMMENTED",
    createdAt: "2025-01-01T00:00:00Z",
    url: "https://example.test/r",
    author: { login: "bob", avatarUrl: "https://avatar.test/b.png" },
    comments: { nodes: [] },
    ...overrides,
  };
}

describe("mapComments", () => {
  it("passes issue comments through as kind=issue", () => {
    const out = mapComments([
      issueComment({ body: "hi", bodyHTML: "<p>hi</p>" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("issue");
    expect(out[0].inlineComments).toBeUndefined();
  });

  it("emits a single review entry for an approval with no body and no inline comments", () => {
    const out = mapComments([review({ state: "APPROVED" })]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("review");
    expect(out[0].reviewState).toBe("APPROVED");
    expect(out[0].inlineComments).toBeUndefined();
  });

  it("attaches inline comments to their parent review instead of emitting them as separate entries", () => {
    const out = mapComments([
      review({
        state: "COMMENTED",
        body: "LGTM besides the nit",
        bodyHTML: "<p>LGTM besides the nit</p>",
        comments: {
          nodes: [
            {
              id: "ic-a",
              body: "nit: rename",
              bodyHTML: "<p>nit: rename</p>",
              createdAt: "2025-01-01T01:00:00Z",
              url: "https://example.test/c/a",
            },
            {
              id: "ic-b",
              body: "same here",
              bodyHTML: "<p>same here</p>",
              createdAt: "2025-01-01T01:05:00Z",
              url: "https://example.test/c/b",
            },
          ],
        },
      }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("review");
    expect(out[0].body).toBe("LGTM besides the nit");
    expect(out[0].inlineComments).toHaveLength(2);
    expect(out[0].inlineComments?.[0].id).toBe("ic-a");
    expect(out[0].inlineComments?.[1].body).toBe("same here");
  });

  it("does not emit a stray 'Reviewed' entry when the body is empty and there are only inline comments", () => {
    const out = mapComments([
      review({
        state: "COMMENTED",
        body: "",
        comments: {
          nodes: [
            {
              id: "ic-a",
              body: "one",
              bodyHTML: "<p>one</p>",
              createdAt: "2025-01-01T00:10:00Z",
              url: "https://example.test/c/a",
            },
          ],
        },
      }),
    ]);

    // Previously this produced TWO entries: a bare "Reviewed" card + the
    // inline comment as a separate card. We want a single merged entry.
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe("");
    expect(out[0].inlineComments).toHaveLength(1);
  });

  it("drops an empty COMMENTED review with no body and no inline comments (GitHub phantom review)", () => {
    const out = mapComments([
      review({ state: "COMMENTED", body: "", comments: { nodes: [] } }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("keeps a bare approval even with no body (so the state badge still renders)", () => {
    const out = mapComments([
      review({ state: "APPROVED", body: "", comments: { nodes: [] } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].reviewState).toBe("APPROVED");
  });
});
