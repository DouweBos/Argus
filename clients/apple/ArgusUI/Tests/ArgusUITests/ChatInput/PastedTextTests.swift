import Testing

@testable import ArgusUI

@Suite("PastedText")
struct PastedTextTests {
  @Test("text copied with images is kept")
  func keepsText() {
    #expect(PastedText.besideImages("look at this", naming: []) == "look at this")
    #expect(PastedText.besideImages("shot.png\nwhy?", naming: ["shot.png"]) == "shot.png\nwhy?")
  }

  @Test("text that only names the images is dropped")
  func dropsNames() {
    #expect(PastedText.besideImages(nil, naming: []) == nil)
    #expect(PastedText.besideImages("  \n", naming: []) == nil)
    #expect(PastedText.besideImages("a.png\nb.png", naming: ["a.png", "b.png"]) == nil)
    #expect(
      PastedText.besideImages("https://x.dev/cat.png", naming: ["https://x.dev/cat.png"]) == nil)
  }
}
