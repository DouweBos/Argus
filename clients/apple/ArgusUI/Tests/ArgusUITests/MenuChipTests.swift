import Testing

@testable import ArgusUI

@MainActor
@Suite("Menu chip")
struct MenuChipTests {
  private let options: [MenuChip<String>.Option] = [
    .init(value: "", label: "Default"),
    .init(value: "codex", label: "Codex", hint: "Custom"),
  ]

  @Test("shows the picked option's label")
  func picked() {
    #expect(MenuChip.valueLabel("", in: options) == "Default")
    #expect(MenuChip.valueLabel("codex", in: options) == "Codex")
  }

  @Test("a value the list doesn't carry shows as itself")
  func unknown() {
    #expect(MenuChip.valueLabel("gone", in: options) == "gone")
  }
}
