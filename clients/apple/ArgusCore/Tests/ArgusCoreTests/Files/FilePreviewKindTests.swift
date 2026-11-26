import Foundation
import Testing

@testable import ArgusCore

@Suite("File previews")
struct FilePreviewKindTests {
  @Test func kindsFollowTheExtension() {
    #expect(FilePreviewKind.of(path: "README.md") == .markdown)
    #expect(FilePreviewKind.of(path: "docs/page.MDX") == .markdown)
    #expect(FilePreviewKind.of(path: "spec.pdf") == .pdf)
    for image in ["a.png", "a.JPG", "a.gif", "a.webp", "icons/a.svg"] {
      #expect(FilePreviewKind.of(path: image) == .image)
    }
    #expect(FilePreviewKind.of(path: "site/index.HTML") == .html)
    #expect(FilePreviewKind.of(path: "a.htm") == .html)
    #expect(FilePreviewKind.of(path: "analysis/Explore.ipynb") == .notebook)
    #expect(FilePreviewKind.html.isRenderedText && !FilePreviewKind.html.isBinary)
    #expect(FilePreviewKind.of(path: "main.swift") == nil)
    #expect(FilePreviewKind.of(path: "Makefile") == nil)
  }

  @Test func relativeLinksResolveAgainstTheDocument() {
    #expect(MarkdownTarget.resolve("guide.md", from: "docs/README.md") == .file(path: "docs/guide.md", line: nil))
    #expect(MarkdownTarget.resolve("../src/a.ts#L12", from: "docs/README.md") == .file(path: "src/a.ts", line: 12))
    #expect(MarkdownTarget.resolve("./img/shot%201.png", from: "README.md") == .file(path: "img/shot 1.png", line: nil))
    #expect(MarkdownTarget.resolve("/docs/a.md", from: "pkg/README.md") == .file(path: "docs/a.md", line: nil))
    #expect(MarkdownTarget.resolve("../../etc/passwd", from: "README.md") == nil)
  }

  @Test func anchorsAndWebLinks() {
    #expect(MarkdownTarget.resolve("#getting-started", from: "README.md") == .anchor("getting-started"))
    #expect(MarkdownTarget.resolve("https://example.com", from: "README.md") == .external(URL(string: "https://example.com")!))
    #expect(MarkdownTarget.resolve("javascript:alert(1)", from: "README.md") == nil)
    #expect(MarkdownTarget.anchor(for: "Getting `Started` (fast)!") == "getting-started-fast")
  }
}
