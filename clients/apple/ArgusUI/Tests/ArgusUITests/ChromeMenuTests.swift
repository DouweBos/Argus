#if os(macOS)
  import Observation
  import Testing

  @testable import ArgusUI

  private final class Flag: @unchecked Sendable { var set = false }

  @Suite("Chrome menu")
  @MainActor
  struct ChromeMenuTests {
    @ChromeMenuBuilder
    private func entries(projects: [String], settings: Bool) -> [ChromeMenuEntry] {
      ChromeMenuEntry.divider
      ChromeMenuItem("All") {}
      ChromeMenuEntry.divider
      ChromeMenuEntry.divider
      for project in projects {
        ChromeMenuItem(project, disabled: project == "B") {}
      }
      if settings {
        ChromeMenuEntry.header("More")
        ChromeMenuEntry.divider
        ChromeMenuItem("Settings…") {}
      }
      ChromeMenuEntry.divider
    }

    private func titles(_ entries: [ChromeMenuEntry]) -> [String] {
      entries.map {
        switch $0 {
        case .item(let item): item.title
        case .divider: "-"
        case .header(let title): "#\(title)"
        case .note(let text): text
        }
      }
    }

    @Test("dividers collapse at the ends, in runs and after headers")
    func tidy() {
      let tidied = ChromeMenuEntry.tidy(entries(projects: ["A", "B"], settings: true))
      #expect(titles(tidied) == ["All", "-", "A", "B", "#More", "Settings…"])
      #expect(titles(ChromeMenuEntry.tidy(entries(projects: [], settings: false))) == ["All"])
    }

    @Test("arrow keys wrap and skip disabled rows")
    func move() {
      let model = ChromeMenuModel()
      model.entries = ChromeMenuEntry.tidy(entries(projects: ["A", "B", "C"], settings: false))
      // All, -, A, B (disabled), C
      model.move(1)
      #expect(model.highlighted == 0)
      model.move(1)
      #expect(model.highlighted == 2)
      model.move(1)
      #expect(model.highlighted == 4)
      model.move(1)
      #expect(model.highlighted == 0)
      model.move(-1)
      #expect(model.highlighted == 4)
    }

    @Test("replacing the rows doesn't read the model, or the anchor re-renders forever")
    func entriesWriteIsUntracked() {
      let model = ChromeMenuModel()
      model.entries = ChromeMenuEntry.tidy(entries(projects: ["A", "B", "C"], settings: false))
      model.highlighted = 2
      let dependsOnModel = Flag()
      withObservationTracking {
        model.entries = ChromeMenuEntry.tidy(entries(projects: ["A", "B"], settings: false))
      } onChange: {
        dependsOnModel.set = true
      }
      model.highlighted = 4
      model.entries = []
      #expect(!dependsOnModel.set)
      #expect(model.highlightedItem == nil)
    }

    @Test("the highlighted item is only an enabled row")
    func highlightedItem() {
      let model = ChromeMenuModel()
      model.entries = ChromeMenuEntry.tidy(entries(projects: ["A", "B", "C"], settings: false))
      model.highlighted = 2
      #expect(model.highlightedItem?.title == "A")
      model.highlighted = 3
      #expect(model.highlightedItem == nil)
    }

    @Test("a row's letter picks it, shown as its hint, unless the row is disabled")
    func letterKeys() {
      let model = ChromeMenuModel()
      let terminal = ChromeMenuItem("Terminal", key: "T") {}
      model.entries = [.item(terminal), .item(ChromeMenuItem("Diff", disabled: true, key: "d") {})]
      #expect(terminal.shortcut == "T")
      #expect(model.item(forKey: "t")?.title == "Terminal")
      #expect(model.item(forKey: "T")?.title == "Terminal")
      #expect(model.item(forKey: "d") == nil)
    }
  }
#endif
