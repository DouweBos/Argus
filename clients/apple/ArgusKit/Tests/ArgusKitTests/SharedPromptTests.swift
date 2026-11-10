import Testing

@testable import ArgusKit

struct SharedPromptTests {
  @Test func nothingSharedLeavesTheDraftEmpty() {
    #expect(SharedPrompt.draft(links: [], texts: ["  "]) == "")
  }

  @Test func linksGoOnTheirOwnLinesAndTextIsQuoted() {
    let draft = SharedPrompt.draft(
      links: ["https://linear.app/argus/issue/ARG-12"], texts: ["Crash on launch\n\nsecond paragraph"])
    #expect(draft == "https://linear.app/argus/issue/ARG-12\n\n> Crash on launch\n>\n> second paragraph\n\n")
  }

  @Test func aLinkSharedAsTextIsALinkAndNotRepeated() {
    let link = "https://github.com/owner/repo/issues/3"
    #expect(SharedPrompt.draft(links: [link], texts: [link, " \(link) "]) == "\(link)\n\n")
    #expect(SharedPrompt.draft(links: [], texts: [link]) == "\(link)\n\n")
  }

  @Test func onlyWebAddressesCountAsLinks() {
    #expect(SharedPrompt.isLink("https://example.com/a?b=1"))
    #expect(!SharedPrompt.isLink("see https://example.com"))
    #expect(!SharedPrompt.isLink("file:///tmp/a.png"))
    #expect(!SharedPrompt.isLink("hello"))
  }
}
