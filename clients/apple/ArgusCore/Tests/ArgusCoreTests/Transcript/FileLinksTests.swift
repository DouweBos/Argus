import ArgusCore
import Foundation
import Testing

/// Cases mirror `app/lib/filePathLink.test.ts`, plus the column and
/// worktree resolution the Mac app adds.
@Suite("File links")
struct FileLinksTests {
  private typealias Ref = FileLinks.FileRef

  @Test("parseFileRef splits path, line and column")
  func parseFileRef() {
    #expect(FileLinks.parseFileRef("src/foo.ts") == Ref(path: "src/foo.ts"))
    #expect(FileLinks.parseFileRef("src/foo.ts:42") == Ref(path: "src/foo.ts", line: 42))
    #expect(
      FileLinks.parseFileRef("src/foo.ts:42:7") == Ref(path: "src/foo.ts", line: 42, column: 7))
  }

  @Test("plain text has no links")
  func plainText() {
    #expect(FileLinks.split("hello world") == [.text("hello world")])
    #expect(FileLinks.split("") == [])
    #expect(FileLinks.splitMentions("") == [])
  }

  @Test("a path with a line becomes one link between text runs")
  func pathWithLine() {
    #expect(
      FileLinks.split("edit src/foo.ts:10 now") == [
        .text("edit "),
        .link(label: "src/foo.ts:10", ref: Ref(path: "src/foo.ts", line: 10)),
        .text(" now"),
      ])
  }

  @Test("line and column are both kept")
  func lineAndColumn() {
    #expect(
      FileLinks.split("at /a/b.swift:3:9.") == [
        .text("at "),
        .link(label: "/a/b.swift:3:9", ref: Ref(path: "/a/b.swift", line: 3, column: 9)),
        .text("."),
      ])
  }

  @Test("unknown extensions are not links")
  func unknownExtension() {
    #expect(FileLinks.split("foo.xyzzy is not a known type") == [.text("foo.xyzzy is not a known type")])
  }

  @Test("bare filenames, ~, ./ and ../ prefixes link; extensions ignore case")
  func prefixes() {
    let labels = FileLinks.matches(in: "package.json ~/x/y.md ./a.ts ../b.ts README.MD")
      .compactMap { match -> String? in
        if case .file(let ref) = match.kind { return ref.path }
        return nil
      }
    #expect(labels == ["package.json", "~/x/y.md", "./a.ts", "../b.ts", "README.MD"])
  }

  @Test("a match spans the whole token and never ends mid-word")
  func wholeToken() {
    #expect(FileLinks.matches(in: "@scope/pkg/index.ts x-y.ts").map(\.range.length) == [19, 6])
    #expect(FileLinks.matches(in: "foo.tsx2").isEmpty)
  }

  @Test("paths in backticks and parentheses link without the punctuation")
  func punctuation() {
    #expect(
      FileLinks.split("see `src/a.ts` (and b/c.go)") == [
        .text("see `"),
        .link(label: "src/a.ts", ref: Ref(path: "src/a.ts")),
        .text("` (and "),
        .link(label: "b/c.go", ref: Ref(path: "b/c.go")),
        .text(")"),
      ])
  }

  @Test("URLs win over paths and lose trailing punctuation")
  func urls() {
    #expect(
      FileLinks.split("visit https://example.com.") == [
        .text("visit "), .url("https://example.com"), .text("."),
      ])
    #expect(FileLinks.split("https://x.dev/a.ts") == [.url("https://x.dev/a.ts")])
    #expect(
      FileLinks.split("(https://x.dev/a_(b)) a.ts") == [
        .text("("), .url("https://x.dev/a_(b)"), .text(") "),
        .link(label: "a.ts", ref: Ref(path: "a.ts")),
      ])
  }

  @Test("ranges are UTF-16, so emoji before a path don't shift it")
  func utf16Ranges() {
    let text = "👋 src/a.ts"
    let match = FileLinks.matches(in: text)[0]
    #expect((text as NSString).substring(with: match.range) == "src/a.ts")
  }

  @Test("mentions need no extension and unescape spaces")
  func mentions() {
    #expect(
      FileLinks.splitMentions("hey @src/foo.ts please") == [
        .text("hey "), .link(label: "@src/foo.ts", ref: Ref(path: "src/foo.ts")), .text(" please"),
      ])
    #expect(
      FileLinks.splitMentions("check @foo/bar.ts, ok?") == [
        .text("check "), .link(label: "@foo/bar.ts", ref: Ref(path: "foo/bar.ts")), .text(", ok?"),
      ])
    #expect(FileLinks.splitMentions("email foo@bar.ts there") == [.text("email foo@bar.ts there")])
    #expect(
      FileLinks.splitMentions(#"see @/Users/d/maestro-results\ (3) please"#) == [
        .text("see "),
        .link(label: #"@/Users/d/maestro-results\ (3)"#, ref: Ref(path: "/Users/d/maestro-results (3)")),
        .text(" please"),
      ])
    #expect(
      FileLinks.splitMentions("see @foo/bar(1).ts now") == [
        .text("see "), .link(label: "@foo/bar(1).ts", ref: Ref(path: "foo/bar(1).ts")), .text(" now"),
      ])
  }

  @Test("a file link's URL keeps line and column through the round trip")
  func linkURLRoundTrip() throws {
    let ref = Ref(path: "src/a b.ts", line: 4, column: 9)
    let url = try #require(FileLinks.url(for: ref))
    #expect(url.scheme == FileLinks.scheme)
    #expect(FileLinks.fileRef(from: url) == ref)
    #expect(FileLinks.fileRef(from: URL(string: "https://x.dev/a.ts")!) == nil)
    #expect(FileLinks.url(for: .url("https://x.dev")) == URL(string: "https://x.dev"))
  }

  @Test("relative paths resolve against the worktree, ~ against home")
  func resolve() {
    #expect(FileLinks.resolve("/a/../b/c.ts", worktree: "/w") == "/b/c.ts")
    #expect(FileLinks.resolve("src/a.ts", worktree: "/w/t") == "/w/t/src/a.ts")
    #expect(FileLinks.resolve("./src/a.ts", worktree: "/w/t") == "/w/t/src/a.ts")
    #expect(FileLinks.resolve("../x.ts", worktree: "/w/t") == "/w/x.ts")
    #expect(FileLinks.resolve("~/n.md", worktree: "/w", home: "/Users/me") == "/Users/me/n.md")
    #expect(FileLinks.resolve("src/a.ts", worktree: nil) == nil)
    #expect(FileLinks.resolve("~/n.md", worktree: "/w") == nil)
  }
}
