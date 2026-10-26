import Foundation
import Testing

@testable import ArgusUI

@Suite("Pill group overflow")
struct PillGroupTests {
  /// One icon item plus the spacing after it.
  private let item = PillMetrics.iconWidth + PillMetrics.spacing

  @Test("everything shows when it fits, without a More menu")
  func allFit() {
    #expect(PillMetrics.visibleCount(5, in: 5 * item - PillMetrics.spacing) == 5)
    #expect(PillMetrics.visibleCount(5, in: .infinity) == 5)
  }

  @Test("the rest overflow, leaving room for the More menu")
  func overflow() {
    // Three items and the More button.
    #expect(PillMetrics.visibleCount(10, in: 3 * item + PillMetrics.iconWidth) == 3)
    #expect(PillMetrics.visibleCount(10, in: 3 * item + PillMetrics.iconWidth - 1) == 2)
  }

  @Test("too narrow for any item leaves only the More menu")
  func none() {
    #expect(PillMetrics.visibleCount(4, in: 10) == 0)
    #expect(PillMetrics.visibleCount(4, in: -50) == 0)
  }

  @Test("a menu that's always there keeps its slot even when the items fit")
  func alwaysMore() {
    #expect(PillMetrics.visibleCount(4, in: 4 * item + PillMetrics.iconWidth, alwaysMore: true) == 4)
    #expect(PillMetrics.visibleCount(4, in: 4 * item - PillMetrics.spacing, alwaysMore: true) == 3)
  }

  @Test("larger text fits fewer")
  func scaled() {
    let width = 6 * item
    #expect(PillMetrics.visibleCount(10, in: width, scale: 1.5) < PillMetrics.visibleCount(10, in: width))
  }
}
