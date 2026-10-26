import ArgusCore
import ArgusUI
import SwiftUI

/// The palette over the main window: type to filter, ↑↓ to pick, ⏎ to run.
struct CommandPaletteView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.openSettings) private var openSettings
  @State private var query = ""
  @State private var selected = 0
  @State private var contentHeight: CGFloat = 0
  @FocusState private var focused: Bool

  /// With nothing typed, what you can do here comes before where you can go.
  private static let sectionOrder = ["Session", "App", "Project", "Navigate", "Settings"]
  private static let maxListHeight: CGFloat = 360

  var body: some View {
    let groups = PaletteMatch.grouped(
      model.palette.matching(query, for: model), order: query.isEmpty ? Self.sectionOrder : []
    ) { $0.section }
    let results = groups.flatMap(\.items)
    CommandPanel {
      CommandPanelField(placeholder, text: $query, focus: $focused)
        .onSubmit { run(results) }
        .onKeyPress(.downArrow) { move(1, in: results) }
        .onKeyPress(.upArrow) { move(-1, in: results) }
        .onKeyPress(.escape) {
          close()
          return .handled
        }
        .accessibilityLabel("Command palette")
    } content: {
      list(groups)
    }
    .onAppear { focused = true }
    .onChange(of: query) { selected = 0 }
  }

  private var placeholder: String {
    model.palette.switcher ? "Open a session…" : "Search commands, projects and sessions…"
  }

  private func list(_ groups: [(section: String, items: [PaletteCommand])]) -> some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(spacing: 0) {
          if groups.isEmpty {
            Text(model.palette.switcher ? "No matching sessions" : "No matching commands")
              .font(.scaled(size: 13))
              .foregroundStyle(theme.textMuted)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(10)
          }
          let starts = Self.offsets(groups)
          ForEach(Array(groups.enumerated()), id: \.element.section) { groupIndex, group in
            CommandPanelHeader(Self.title(group.section))
            ForEach(Array(group.items.enumerated()), id: \.element.id) { offset, command in
              let index = starts[groupIndex] + offset
              CommandPanelRow(
                systemImage: command.systemImage ?? "command", title: command.title, subtitle: command.subtitle,
                shortcut: command.shortcut, selected: index == selected
              )
              .id(index)
              .onTapGesture { perform(command) }
            }
          }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 6)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
      }
      .scrollIndicators(.automatic)
      .frame(height: min(max(contentHeight, 40), Self.maxListHeight))
      .onChange(of: selected) { _, index in proxy.scrollTo(index) }
    }
  }

  /// Each group's first row in the flat list ↑↓ walks.
  private static func offsets(_ groups: [(section: String, items: [PaletteCommand])]) -> [Int] {
    var starts: [Int] = []
    var total = 0
    for group in groups {
      starts.append(total)
      total += group.items.count
    }
    return starts
  }

  /// The header a section reads as; the section name itself is what telemetry sees.
  private static func title(_ section: String) -> String {
    section == "App" ? "Actions" : section
  }

  private func move(_ delta: Int, in results: [PaletteCommand]) -> KeyPress.Result {
    guard !results.isEmpty else { return .handled }
    selected = (selected + delta + results.count) % results.count
    return .handled
  }

  private func run(_ results: [PaletteCommand]) {
    guard results.indices.contains(selected) else { return }
    perform(results[selected])
  }

  private func perform(_ command: PaletteCommand) {
    close()
    MacTelemetry.capture(.paletteCommandRun(section: command.section))
    command.run()
    if command.opensSettings { openSettings() }
  }

  private func close() {
    model.palette.isPresented = false
  }
}
