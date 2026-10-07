import ArgusCore
import Foundation
import Testing

@Suite("Transcript window")
struct TranscriptWindowTests {
  private func message(_ index: Int) -> RemoteMessage {
    RemoteMessage(id: "m\(index)", role: .assistant, textBlocks: ["\(index)"], toolCalls: [])
  }

  private func segments(_ count: Int) -> [ToolGroups.Segment] {
    (0..<count).map { .single(message($0)) }
  }

  @Test("renders the last page until something is pinned")
  func tail() {
    let all = segments(500)
    let window = TranscriptWindow()
    #expect(window.start(all) == 500 - TranscriptWindow.page)
    #expect(window.visible(all).count == TranscriptWindow.page)
    #expect(window.hasHidden(all))
    #expect(!window.hasHidden(segments(10)))
  }

  @Test("a pinned window keeps its first row as output arrives below")
  func pinned() {
    var window = TranscriptWindow()
    let all = segments(500)
    window.pinned = window.visible(all).first?.firstMessageId
    #expect(window.visible(segments(520)).first?.id == "m440")
    #expect(window.visible(segments(520)).count == 80)
  }

  @Test("growing reveals a page above, down to the first row")
  func grow() {
    var window = TranscriptWindow()
    let all = segments(130)
    window.grow(all)
    #expect(window.start(all) == 130 - 2 * TranscriptWindow.page)
    window.grow(all)
    window.grow(all)
    #expect(window.start(all) == 0)
    #expect(!window.hasHidden(all))
  }

  @Test("including a message above renders it with a little context")
  func include() {
    var window = TranscriptWindow()
    let all = segments(500)
    window.include("m100", in: all)
    #expect(window.start(all) == 96)
    // Already rendered: nothing moves.
    window.include("m300", in: all)
    #expect(window.start(all) == 96)
  }

  @Test("trimming back to the last page only once the window is large")
  func trim() {
    var window = TranscriptWindow(pinned: "m400")
    let all = segments(500)
    window.trim(all)
    #expect(window.start(all) == 400)
    window.pinned = "m0"
    window.trim(all)
    #expect(window.start(all) == 500 - TranscriptWindow.page)
  }

  @Test("a pin inside a collapsed group finds the group; a vanished pin falls back to the tail")
  func groups() {
    let all: [ToolGroups.Segment] =
      (0..<100).map { .single(message($0)) } + [.collapsed([message(100), message(101), message(102)])]
      + (103..<200).map { .single(message($0)) }
    #expect(TranscriptWindow(pinned: "m101").start(all) == 100)
    #expect(TranscriptWindow(pinned: "gone").start(all) == all.count - TranscriptWindow.page)
  }
}
