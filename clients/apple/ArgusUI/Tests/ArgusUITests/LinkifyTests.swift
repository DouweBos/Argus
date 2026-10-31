import ArgusCore
import Foundation
import Testing

@testable import ArgusUI

@Suite("Linkify")
struct LinkifyTests {
  private func links(_ text: String, files: Bool, mentions: Bool = false) -> [URL] {
    AttributedString(text).linkified(files: files, mentions: mentions).runs.compactMap(\.link)
  }

  @Test("bare URLs link even where files don't")
  func bareURLs() {
    #expect(links("see https://x.dev/a and src/a.ts:3:2", files: false) == [URL(string: "https://x.dev/a")!])
    let linked = links("see https://x.dev/a and src/a.ts:3:2", files: true)
    #expect(linked.count == 2)
    #expect(FileLinks.fileRef(from: linked[1]) == FileLinks.FileRef(path: "src/a.ts", line: 3, column: 2))
  }

  @Test("typed text links @mentions, not bare paths")
  func mentions() {
    let linked = links("look at @docs/plan and src/a.ts", files: true, mentions: true)
    #expect(linked.map { FileLinks.fileRef(from: $0)?.path } == ["docs/plan"])
  }

  @Test("markdown's own links stay")
  func keepsMarkdownLinks() throws {
    let source = try AttributedString(markdown: "[a.ts](https://x.dev) then https://y.dev")
    let linked = source.linkified(files: true).runs.compactMap(\.link)
    #expect(linked == [URL(string: "https://x.dev")!, URL(string: "https://y.dev")!])
  }
}
