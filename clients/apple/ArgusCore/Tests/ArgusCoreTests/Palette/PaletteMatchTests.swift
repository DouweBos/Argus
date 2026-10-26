import Testing

@testable import ArgusCore

struct PaletteMatchTests {
  @Test func requiresEveryCharacterInOrder() {
    #expect(PaletteMatch.score("nse", in: "New Session") != nil)
    #expect(PaletteMatch.score("sn", in: "Snapshot") != nil)
    #expect(PaletteMatch.score("xyz", in: "New Session") == nil)
    #expect(PaletteMatch.score("onew", in: "New Session") == nil)
  }

  @Test func wordStartsOutrankScatteredLetters() {
    let ranked = PaletteMatch.rank(["Agents", "New Session"], query: "ns") { [$0] }
    #expect(ranked == ["New Session", "Agents"])
  }

  @Test func contiguousRunsOutrankWordStarts() {
    let ranked = PaletteMatch.rank(["Session Show Terminal", "App Settings…"], query: "set") { [$0] }
    #expect(ranked.first == "App Settings…")
  }

  @Test func emptyQueryKeepsOrder() {
    #expect(PaletteMatch.rank(["b", "a"], query: " ") { [$0] } == ["b", "a"])
  }

  @Test func matchesAnyOfAnItemsTexts() {
    let ranked = PaletteMatch.rank([("Settings", "preferences")], query: "pref") { [$0.0, $0.1] }
    #expect(ranked.count == 1)
  }

  @Test func groupsRunsBySectionKeepingOrder() {
    let items = [("Go", "Navigate"), ("Delete", "Session"), ("Home", "Navigate"), ("Fix", "Git")]
    let groups = PaletteMatch.grouped(items) { $0.1 }
    #expect(groups.map(\.section) == ["Navigate", "Session", "Git"])
    #expect(groups[0].items.map(\.0) == ["Go", "Home"])
  }

  @Test func preferredSectionsComeFirst() {
    let items = [("Go", "Navigate"), ("Fix", "Git"), ("Delete", "Session")]
    let groups = PaletteMatch.grouped(items, order: ["Session", "App"]) { $0.1 }
    #expect(groups.map(\.section) == ["Session", "Navigate", "Git"])
  }
}
