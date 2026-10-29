import Testing
@testable import ArgusKit

@Suite("Linear media links")
struct LinearMediaLinkTests {
  let upload = "https://uploads.linear.app/abc/def/ghi"

  @Test("a Linear image on its own line embeds")
  func image() {
    #expect(
      LinearMediaLink.parse(line: "![shot.png](\(upload))")
        == LinearMediaLink(kind: .image, url: upload, label: "shot.png"))
  }

  @Test("a link named like a recording is a video, other links stay links")
  func video() {
    #expect(LinearMediaLink.parse(line: "[Screen Recording.mov](\(upload))")?.kind == .video)
    #expect(LinearMediaLink.parse(line: "[clip](\(upload)/clip.MP4)")?.kind == .video)
    #expect(LinearMediaLink.parse(line: "[notes.pdf](\(upload))") == nil)
  }

  @Test("only uploads on Linear's host, filling the line")
  func scope() {
    #expect(LinearMediaLink.parse(line: "![x.png](https://example.com/x.png)") == nil)
    #expect(LinearMediaLink.parse(line: "see ![x.png](\(upload))") == nil)
  }

  @Test("a paragraph splits around its uploads")
  func segments() {
    let segments = LinearMediaLink.segments("Before\n![a.png](\(upload))\nafter one\nafter two")
    #expect(
      segments == [
        .text("Before"), .media(LinearMediaLink(kind: .image, url: upload, label: "a.png")),
        .text("after one\nafter two"),
      ])
    #expect(LinearMediaLink.segments("plain") == [.text("plain")])
  }
}
