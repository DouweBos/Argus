import ArgusUI
import SwiftUI

/// The palette over the main window: type to filter, ↑↓ to pick, ⏎ to run.
struct CommandPaletteView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.openSettings) private var openSettings
  @State private var query = ""
  @State private var selected = 0
  @FocusState private var focused: Bool

  var body: some View {
    let results = model.palette.matching(query, for: model)
    VStack(spacing: 0) {
      TextField(model.palette.switcher ? "Open a session…" : "Type a command…", text: $query)
        .textFieldStyle(.plain)
        .font(.scaled(.title3))
        .padding(12)
        .focused($focused)
        .onSubmit { run(results) }
        .onKeyPress(.downArrow) { move(1, in: results) }
        .onKeyPress(.upArrow) { move(-1, in: results) }
        .onKeyPress(.escape) {
          close()
          return .handled
        }
        .accessibilityLabel("Command palette")
      Divider()
      ScrollViewReader { proxy in
        List {
          if results.isEmpty {
            Text(model.palette.switcher ? "No matching sessions" : "No matching commands").foregroundStyle(.secondary)
          }
          ForEach(Array(results.enumerated()), id: \.element.id) { index, command in
            PaletteRow(command: command, selected: index == selected)
              .id(index)
              .contentShape(Rectangle())
              .onTapGesture { perform(command) }
          }
        }
        .listStyle(.plain)
        .onChange(of: selected) { _, index in proxy.scrollTo(index) }
      }
      .frame(height: 340)
    }
    .frame(width: 560)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(theme.border))
    .shadow(radius: 24)
    .onAppear { focused = true }
    .onChange(of: query) { selected = 0 }
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

private struct PaletteRow: View {
  @Environment(\.theme) private var theme
  let command: PaletteCommand
  let selected: Bool

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: command.systemImage ?? "command")
        .frame(width: 18)
        .foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 1) {
        Text(command.title)
        if let subtitle = command.subtitle {
          Text(subtitle).font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(1)
        }
      }
      Spacer()
      Text(command.section).font(.scaled(.caption)).foregroundStyle(.tertiary)
      if let shortcut = command.shortcut {
        KeyHint(shortcut, size: 10, boxed: false).foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 3)
    .listRowBackground(selected ? theme.accentSoft : Color.clear)
  }
}
