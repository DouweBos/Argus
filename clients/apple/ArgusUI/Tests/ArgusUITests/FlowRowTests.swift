import CoreGraphics
import Testing

@testable import ArgusUI

@Suite("FlowRow cell widths")
struct FlowRowTests {
  @Test("buttons share the row in equal columns")
  func equalColumns() {
    #expect(FlowRow.cellWidths(ideals: [60, 80], in: 308, spacing: 8, packed: false) == [150, 150])
  }

  @Test("a wider label keeps its width and the rest is shared")
  func widerLabel() {
    #expect(FlowRow.cellWidths(ideals: [200, 40], in: 308, spacing: 8, packed: false) == [230, 70])
  }

  @Test("packed badges keep their own width on a wide card")
  func packed() {
    #expect(FlowRow.cellWidths(ideals: [70, 90, 60], in: 760, spacing: 6, packed: true) == [70, 90, 60])
  }

  @Test("a packed badge wider than the row is capped to it")
  func packedCapped() {
    #expect(FlowRow.cellWidths(ideals: [400], in: 300, spacing: 6, packed: true) == [300])
  }
}
