import Foundation
import Testing

@testable import Argus

@MainActor
struct SidePanelModelTests {
  private func model() -> (SidePanelModel, URL) {
    let file = FileManager.default.temporaryDirectory
      .appendingPathComponent("argus-side-panel-\(UUID().uuidString)").appendingPathComponent("x.plist")
    return (SidePanelModel(defaults: HomeDefaults(file: file)), file)
  }

  @Test func closedUntilATabIsOpened() {
    let (panels, _) = model()
    #expect(!panels.isOpen("s1"))
    panels.show(PanelTab(kind: .device), session: "s1", terminals: [])
    #expect(panels.isOpen("s1"))
    #expect(!panels.isOpen("s2"))
    #expect(!panels.isOpen(nil))
  }

  @Test func terminalTabsFollowTheSessionsTerminals() {
    let stored = [PanelTab.terminal("a"), PanelTab(kind: .diff), PanelTab.terminal("gone")]
    #expect(SidePanelModel.tabs(stored, terminals: nil) == stored)
    let tabs = SidePanelModel.tabs(stored, terminals: ["a", "run"])
    #expect(tabs.map(\.id) == ["terminal:a", "diff", "terminal:run"])
  }

  @Test func aNewTabOpensBesideTheOneInFrontAndKindsOtherThanTerminalAreSingle() {
    let (panels, _) = model()
    panels.show(PanelTab(kind: .device), session: "s1", terminals: [])
    panels.show(PanelTab(kind: .files), session: "s1", terminals: [])
    panels.select("device", session: "s1")
    panels.show(PanelTab(kind: .diff), session: "s1", terminals: [])
    panels.show(PanelTab(kind: .device), session: "s1", terminals: [])
    #expect(panels.tabs("s1", terminals: []).map(\.id) == ["device", "diff", "files"])
    #expect(panels.selected("s1", terminals: [])?.kind == .device)
  }

  @Test func closingTheLastTabClosesThePanelAndANeighbourTakesOver() {
    let (panels, _) = model()
    panels.show(PanelTab(kind: .device), session: "s1", terminals: [])
    panels.show(PanelTab(kind: .browser), session: "s1", terminals: [])
    panels.remove("browser", session: "s1", terminals: [])
    #expect(panels.selected("s1", terminals: [])?.kind == .device)
    #expect(panels.isOpen("s1"))
    panels.remove("device", session: "s1", terminals: [])
    #expect(!panels.isOpen("s1"))
  }

  @Test func dragReorders() {
    let (panels, _) = model()
    for kind in [PanelTabKind.device, .files, .diff] {
      panels.show(PanelTab(kind: kind), session: nil, terminals: [])
    }
    panels.move("diff", to: "device", session: nil, terminals: [])
    #expect(panels.tabs(nil, terminals: []).map(\.id) == ["diff", "device", "files"])
  }

  @Test func rememberedAcrossLaunchesExceptMaximized() {
    let (panels, file) = model()
    panels.show(PanelTab.terminal("t1"), session: "s1", terminals: ["t1"])
    panels.setWidth(512, session: "s1")
    panels.toggleMaximized("s1")
    panels.save()
    let reopened = SidePanelModel(defaults: HomeDefaults(file: file))
    #expect(reopened.isOpen("s1"))
    #expect(reopened.width("s1") == 512)
    #expect(reopened.selected("s1", terminals: ["t1"])?.terminalId == "t1")
    #expect(!reopened.isMaximized("s1"))
  }
}
