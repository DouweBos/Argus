import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: {
  path: string;
  method?: string;
  fields?: Record<string, unknown>;
}[] = [];

vi.mock("./glab", () => ({
  projectApiPath: (p: string) => `projects/${encodeURIComponent(p)}`,
  glabRest: vi.fn(
    async (
      _host: string,
      path: string,
      options: { fields?: Record<string, unknown>; method?: string } = {},
    ) => {
      calls.push({ path, method: options.method, fields: options.fields });

      return { diff_refs: { base_sha: "b", start_sha: "s", head_sha: "h" } };
    },
  ),
}));

const { reviewMergeRequest } = await import("./mrReview");
const ref = { kind: "gitlab" as const, host: "gitlab.com", path: "g/sub/p" };
const mr = "projects/g%2Fsub%2Fp/merge_requests/7";

describe("reviewMergeRequest", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("puts each comment on its line as a diff discussion, then approves", async () => {
    await reviewMergeRequest(ref, 7, {
      event: "APPROVE",
      body: "",
      comments: [
        {
          path: "a.ts",
          side: "RIGHT",
          line: 12,
          start_line: 10,
          body: "Split.",
        },
        { path: "a.ts", side: "LEFT", line: 3, body: "Why?" },
      ],
    });
    expect(calls.map((c) => c.path)).toEqual([
      mr,
      `${mr}/discussions`,
      `${mr}/discussions`,
      `${mr}/approve`,
    ]);
    expect(calls[1]?.fields).toMatchObject({
      "position[head_sha]": "h",
      "position[new_path]": "a.ts",
      "position[new_line]": 12,
    });
    expect(calls[2]?.fields).toMatchObject({ "position[old_line]": 3 });
  });

  it("says a change request in a note, without reading the diff when there are no comments", async () => {
    await reviewMergeRequest(ref, 7, {
      event: "REQUEST_CHANGES",
      body: "Needs tests.",
      comments: [],
    });
    expect(calls).toEqual([
      {
        path: `${mr}/notes`,
        method: "POST",
        fields: { body: "**Changes requested.**\n\nNeeds tests." },
      },
    ]);
  });
});
