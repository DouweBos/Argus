import { describe, expect, it } from "vitest";
import { markdownToMrkdwn, truncateMrkdwn } from "./mrkdwn";

describe("markdownToMrkdwn", () => {
  it("converts emphasis, strike and headings", () => {
    expect(markdownToMrkdwn("**Done** with *this* and ~~that~~")).toBe(
      "*Done* with _this_ and ~that~",
    );
    expect(markdownToMrkdwn("## Summary of **changes**")).toBe(
      "*Summary of changes*",
    );
  });

  it("turns links and images into Slack links", () => {
    expect(markdownToMrkdwn("See [the PR](https://x.dev/pr/1).")).toBe(
      "See <https://x.dev/pr/1|the PR>.",
    );
    expect(markdownToMrkdwn("![shot](https://x.dev/a.png)")).toBe(
      "<https://x.dev/a.png|shot>",
    );
  });

  it("escapes Slack's control characters outside links", () => {
    expect(markdownToMrkdwn("a < b && c > d")).toBe(
      "a &lt; b &amp;&amp; c &gt; d",
    );
    expect(markdownToMrkdwn("<!channel> ping")).toBe("&lt;!channel&gt; ping");
  });

  it("leaves code alone apart from escaping", () => {
    const md = "Run `pnpm **test**`:\n\n```ts\nconst a = b && *c*;\n```";
    expect(markdownToMrkdwn(md)).toBe(
      "Run `pnpm **test**`:\n\n```\nconst a = b &amp;&amp; *c*;\n```",
    );
  });

  it("closes a code block the reply left open", () => {
    expect(markdownToMrkdwn("```\nx")).toBe("```\nx\n```");
  });

  it("renders lists and task lists", () => {
    expect(
      markdownToMrkdwn("- one\n  - two\n1. first\n- [x] done\n- [ ] todo"),
    ).toBe("• one\n    • two\n1. first\n☑ done\n☐ todo");
  });

  it("keeps quotes and puts tables in a code block", () => {
    expect(markdownToMrkdwn("> note")).toBe("> note");
    expect(markdownToMrkdwn("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(
      "```\n| a | b |\n| 1 | 2 |\n```",
    );
  });

  it("keeps snake_case and lone asterisks as they are", () => {
    expect(markdownToMrkdwn("use snake_case_name and 2 * 3")).toBe(
      "use snake_case_name and 2 * 3",
    );
  });
});

describe("truncateMrkdwn", () => {
  it("leaves short text alone", () => {
    expect(truncateMrkdwn("short", 100, null)).toBe("short");
  });

  it("cuts at a paragraph and links the rest", () => {
    const text = `${"a".repeat(100)}\n\n${"b".repeat(100)}`;
    const cut = truncateMrkdwn(text, 200, "argus://sessions/s/agents/a");
    expect(cut.startsWith("a".repeat(100))).toBe(true);
    expect(cut).not.toContain("b");
    expect(cut).toContain(
      "<argus://sessions/s/agents/a|View the full reply in Argus>",
    );
    expect(cut.length).toBeLessThanOrEqual(200);
  });

  it("closes a code block it cut through", () => {
    const text = `\`\`\`\n${"line\n".repeat(50)}\`\`\``;
    const cut = truncateMrkdwn(text, 100, null);
    expect(cut.match(/```/g)?.length).toBe(2);
  });
});
