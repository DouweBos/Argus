import CoreGraphics
import Testing

@testable import ArgusUI

@Suite("ChipFlowLayout")
struct ChipFlowLayoutTests {
  private let chip = CGSize(width: 100, height: 20)

  @Test("chips that fit share one row")
  func oneRow() {
    let rows = ChipFlowLayout.rows(sizes: [chip, chip, chip], width: 400, spacing: 6)
    #expect(rows.map(\.indices) == [[0, 1, 2]])
    #expect(rows[0].width == 312)
  }

  @Test("a chip that doesn't fit starts the next row")
  func wraps() {
    let rows = ChipFlowLayout.rows(sizes: [chip, chip, chip], width: 210, spacing: 6)
    #expect(rows.map(\.indices) == [[0, 1], [2]])
  }

  @Test("a chip wider than the row gets a row of its own, clamped")
  func clamps() {
    let rows = ChipFlowLayout.rows(
      sizes: [chip, CGSize(width: 500, height: 24)], width: 300, spacing: 6)
    #expect(rows.map(\.indices) == [[0], [1]])
    #expect(rows[1].width == 300)
    #expect(rows[1].height == 24)
  }
}
