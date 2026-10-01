import Foundation
import Testing
@testable import ArgusKit

/// The `@`-mention picker has two modes and the switch between them is
/// keystroke-sensitive, which is exactly where it goes wrong.
@Suite("Mention queries")
struct MentionQueryTests {

  @Test("detects a mention only at the start of a word")
  func detection() {
    #expect(MentionQuery.detect(in: "@src") == "src")
    #expect(MentionQuery.detect(in: "look at @src") == "src")
    #expect(MentionQuery.detect(in: "@") == "")
    // Mid-word is an email or a handle, not a file mention.
    #expect(MentionQuery.detect(in: "me@example.com") == nil)
    // A space ends it.
    #expect(MentionQuery.detect(in: "@src lib") == nil)
    #expect(MentionQuery.detect(in: "no mention here") == nil)
  }

  @Test("takes the last mention when there are several")
  func lastWins() {
    #expect(MentionQuery.detect(in: "@one.txt and @two") == "two")
  }

  @Test("a path switches to browse mode")
  func browseMode() {
    #expect(MentionQuery.isBrowsing("src/"))
    #expect(MentionQuery.isBrowsing("src/lib"))
    #expect(MentionQuery.isBrowsing("~/Work"))
    #expect(MentionQuery.isBrowsing("./local"))
    #expect(!MentionQuery.isBrowsing("readme"))
    #expect(!MentionQuery.isBrowsing(""))
  }

  @Test("ranks exact over prefix over contains")
  func ranking() {
    let files = ["src/app.ts", "app.ts", "docs/recap.ts", "application.ts"]
    let results = MentionQuery.search(files, query: "app.ts")
    #expect(results.first == "app.ts")
    #expect(!results.contains("docs/recap.ts"))
  }

  @Test("an empty query lists the first page")
  func emptyQuery() {
    let files = (0..<40).map { "file\($0).ts" }
    #expect(MentionQuery.search(files, query: "").count == MentionQuery.maxResults)
  }

  @Test("joins child paths without doubling the separator")
  func childPaths() {
    #expect(MentionQuery.childPath("src", "app.ts") == "src/app.ts")
    #expect(MentionQuery.childPath("src/", "app.ts") == "src/app.ts")
  }

  @Test("a directory keeps the picker open, a file closes it")
  func replacement() {
    // Trailing slash means the next lookup browses into it.
    #expect(
      MentionQuery.replacing(in: "look at @src", with: "src/lib", isDirectory: true)
        == "look at @src/lib/")
    #expect(
      MentionQuery.replacing(in: "look at @src", with: "src/lib", isDirectory: false)
        == "look at @src/lib ")
    // An already-slashed directory isn't doubled.
    #expect(
      MentionQuery.replacing(in: "@s", with: "src/", isDirectory: true) == "@src/")
  }

  @Test("replacing leaves text alone when there is no mention")
  func noMention() {
    #expect(MentionQuery.replacing(in: "plain text", with: "x", isDirectory: false)
      == "plain text")
  }
}
