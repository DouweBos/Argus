import SwiftUI
import Testing

@testable import Argus

struct ResizableSplitTests {
  private func width(_ stored: CGFloat, total: CGFloat) -> CGFloat {
    ResizableHSplit<EmptyView, EmptyView>.leadingWidth(stored: stored, total: total, min: 200, max: 500, trailingMin: 300)
  }

  @Test func keepsTheRememberedWidthWithinItsBounds() {
    #expect(width(320, total: 1200) == 320)
    #expect(width(900, total: 1200) == 500)
    #expect(width(50, total: 1200) == 200)
  }

  @Test func givesUpWidthBeforeTheTrailingPaneDropsBelowItsMinimum() {
    #expect(width(480, total: 700) == 393)
    // Too narrow for both minimums: the leading pane goes below its own.
    #expect(width(480, total: 450) == 143)
    #expect(width(480, total: 0) == 480)
  }
}
