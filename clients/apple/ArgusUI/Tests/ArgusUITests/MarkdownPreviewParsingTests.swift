import Testing

@testable import ArgusUI

@Suite("Markdown preview parsing")
struct MarkdownPreviewParsingTests {
  @Test func aParagraphOfOnlyImagesIsAnImageLine() {
    #expect(
      MarkdownImageLine.images(in: "![CI](https://x/badge.svg) ![shot](docs/shot.png \"Home\")")
        == [.init(alt: "CI", source: "https://x/badge.svg"), .init(alt: "shot", source: "docs/shot.png")])
    #expect(MarkdownImageLine.images(in: "See ![x](a.png) here") == nil)
    #expect(MarkdownImageLine.images(in: "plain text") == nil)
  }

  @Test func taskItems() {
    #expect(MarkdownTask.split("[x] Ship it")! == (true, "Ship it"))
    #expect(MarkdownTask.split("[ ] Test it")! == (false, "Test it"))
    #expect(MarkdownTask.split("[link](a.md)") == nil)
  }
}
