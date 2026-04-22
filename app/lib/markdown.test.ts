// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHtml, renderMarkdown } from "./markdown";

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

  describe("gfm task lists", () => {
    const markdown = "- [ ] tvOS\n- [x] iOS\n- [x] Android TV\n- [ ] Fire TV";

    it("emits a task-check span for every checkbox in markdown source", () => {
      const html = renderMarkdown(markdown);
      const matches = html.match(/data-task-check=/g) ?? [];
      expect(matches).toHaveLength(4);
    });

    it("marks checked / unchecked state correctly", () => {
      const html = renderMarkdown(markdown);
      expect(html).toMatch(/<span data-task-check="unchecked"><\/span>\s*tvOS/);
      expect(html).toMatch(/<span data-task-check="checked"><\/span>\s*iOS/);
      expect(html).toMatch(
        /<span data-task-check="checked"><\/span>\s*Android TV/,
      );
      expect(html).toMatch(
        /<span data-task-check="unchecked"><\/span>\s*Fire TV/,
      );
    });

    it("never leaves a raw <input> behind", () => {
      const html = renderMarkdown(markdown);
      expect(html).not.toMatch(/<input/);
    });
  });
});

describe("renderHtml (GitHub bodyHTML)", () => {
  // Real GitHub bodyHTML shape — what the `gh api graphql` response feeds
  // into renderHtml on the PR detail screen.
  const githubTaskList = `<ul class="contains-task-list">
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled=""> tvOS</li>
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled="" checked=""> iOS</li>
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled="" checked=""> Android TV</li>
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled=""> Fire TV</li>
</ul>`;

  it("replaces every GitHub checkbox input with a data-task-check span", () => {
    const html = renderHtml(githubTaskList);
    const matches = html.match(/data-task-check=/g) ?? [];
    expect(matches).toHaveLength(4);
  });

  it("preserves checked / unchecked state from the source", () => {
    const html = renderHtml(githubTaskList);
    expect(html).toMatch(/<span data-task-check="unchecked"><\/span>\s*tvOS/);
    expect(html).toMatch(/<span data-task-check="checked"><\/span>\s*iOS/);
    expect(html).toMatch(
      /<span data-task-check="checked"><\/span>\s*Android TV/,
    );
    expect(html).toMatch(
      /<span data-task-check="unchecked"><\/span>\s*Fire TV/,
    );
  });

  it("never leaves a raw <input> behind", () => {
    const html = renderHtml(githubTaskList);
    expect(html).not.toMatch(/<input/);
  });

  it("keeps the list-wrapping class so the row layout can kick in", () => {
    const html = renderHtml(githubTaskList);
    expect(html).toContain('class="contains-task-list"');
  });
});
