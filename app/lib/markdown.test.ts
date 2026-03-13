import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders plain text as a paragraph", () => {
    const html = renderMarkdown("Hello world");
    expect(html).toContain("<p>Hello world</p>");
  });

  it("renders headings", () => {
    const html = renderMarkdown("# Title");
    expect(html).toContain("<h1>");
    expect(html).toContain("Title");
  });

  it("renders bold text", () => {
    const html = renderMarkdown("**bold**");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders inline code", () => {
    const html = renderMarkdown("`code`");
    expect(html).toContain("<code>code</code>");
  });

  it("renders fenced code blocks (GFM)", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
  });

  it("renders links", () => {
    const html = renderMarkdown("[click](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("click");
  });

  it("converts line breaks (breaks: true)", () => {
    const html = renderMarkdown("line one\nline two");
    expect(html).toContain("<br>");
  });

  it("renders unordered lists", () => {
    const html = renderMarkdown("- item one\n- item two");
    expect(html).toContain("<li>item one");
    expect(html).toContain("<li>item two");
  });

  it("returns a string (not a Promise)", () => {
    const result = renderMarkdown("test");
    expect(typeof result).toBe("string");
  });
});
