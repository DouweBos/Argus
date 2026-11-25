import ArgusCore
import ArgusUI
import SwiftUI

/// Settings → Keyboard: every command's key, grouped as the menus are, each with a recorder.
/// The keymap in `AppPreferences` is the one every menu, hint and the shortcut router reads.
struct KeyboardSettingsTab: View {
  @Environment(\.theme) private var theme
  var prefs = AppPreferences.shared
  @State private var query = ""
  @State private var recording: ShortcutCommand?
  @State private var listener = ShortcutKeyListener()
  @State private var confirmingReset = false

  var body: some View {
    let keymap = prefs.shortcutKeymap
    let groups = Self.groups(matching: query, in: keymap)
    SettingsPage {
      search
      if groups.isEmpty {
        Text("No commands match \u{201C}\(query)\u{201D}.")
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
          .padding(.horizontal, 12)
      }
      ForEach(groups, id: \.area) { group in
        SettingsGroup(group.area.title, footer: Self.footers[group.area]) {
          ForEach(group.commands, id: \.id) { command in
            row(command, keymap)
          }
        }
      }
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("Reset All") { confirmingReset = true }
          .disabled(!keymap.hasCustomizations)
          .help("Put every shortcut back to Argus's default")
      }
    }
    .confirmationDialog("Reset every shortcut to its default?", isPresented: $confirmingReset) {
      Button("Reset All", role: .destructive) { prefs.resetAllShortcuts() }
    }
    .onChange(of: recording) { _, command in listen(for: command) }
    .onDisappear { listener.stop() }
  }

  private var search: some View {
    ChromeSearchField("Search commands or keys", text: $query)
      .padding(.horizontal, 6)
      .padding(.vertical, 3)
      .background(theme.surface, in: .rect(cornerRadius: theme.radiusSmall + 2))
      .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall + 2).strokeBorder(theme.border))
  }

  private func row(_ command: ShortcutCommand, _ keymap: ShortcutKeymap) -> some View {
    let conflicts = keymap.conflicts(for: command.id).compactMap(ShortcutCommand.named)
    let system = keymap.systemShortcut(for: command.id)
    let customized = keymap.isCustomized(command.id)
    return SettingsRow(command.title, description: Self.scopeNote(command.scope)) {
      HStack(spacing: 6) {
        if customized {
          Button {
            prefs.resetShortcut(command)
          } label: {
            Image(systemName: "arrow.uturn.backward").font(.scaled(size: 11, weight: .medium))
          }
          .buttonStyle(.argusBorderless)
          .foregroundStyle(theme.textSecondary)
          .help(command.defaultChord.map { "Reset to \($0.display)" } ?? "Reset to no shortcut")
          .accessibilityLabel("Reset to default")
        }
        ShortcutRecorder(
          chord: keymap.chord(for: command),
          fixed: command.isFixed ? (command.sequence.isEmpty ? command.defaultChord.map { [$0] } ?? [] : command.sequence) : nil,
          isRecording: recording == command, conflict: !conflicts.isEmpty
        ) {
          recording = recording == command ? nil : command
        }
      }
    } detail: {
      if !conflicts.isEmpty {
        warning(
          "Also \(conflicts.map { "\($0.title) (\($0.area.title))" }.formatted(.list(type: .and))): only one of them runs.",
          color: theme.error)
      }
      if let system {
        warning("macOS uses \(system.chord.display) for \(system.name).", color: theme.warning)
      }
    }
  }

  private func warning(_ text: String, color: Color) -> some View {
    Label {
      Text(text).fixedSize(horizontal: false, vertical: true)
    } icon: {
      Image(systemName: "exclamationmark.triangle.fill")
    }
    .font(.scaled(size: 11.5))
    .foregroundStyle(color)
  }

  private func listen(for command: ShortcutCommand?) {
    guard let command else {
      listener.stop()
      return
    }
    listener.start { outcome in
      switch outcome {
      case .chord(let chord): prefs.rebind(command, to: chord)
      case .clear: prefs.rebind(command, to: nil)
      case .cancel: break
      }
      recording = nil
    }
  }

  // MARK: Listing

  struct AreaRows {
    let area: ShortcutArea
    let commands: [ShortcutCommand]
  }

  /// The catalog by area, narrowed to commands whose title, area or key has `query` in it.
  static func groups(matching query: String, in keymap: ShortcutKeymap) -> [AreaRows] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    return ShortcutArea.allCases.compactMap { area in
      let commands = ShortcutCommand.all.filter { command in
        guard command.area == area else { return false }
        guard !needle.isEmpty else { return true }
        let key = keymap.chord(for: command)?.display.lowercased() ?? ""
        return command.title.lowercased().contains(needle) || area.title.lowercased().contains(needle)
          || (!key.isEmpty && key.contains(needle))
      }
      return commands.isEmpty ? nil : AreaRows(area: area, commands: commands)
    }
  }

  private static func scopeNote(_ scope: ShortcutScope) -> String? {
    switch scope {
    case .global: nil
    case .session: "In a session"
    case .code: "In the code view"
    case .gitPanel: "In the git view and the Diff tab"
    case .editor: "While the editor has focus"
    }
  }

  private static let footers: [ShortcutArea: String] = [
    .app: "A narrower place can reuse a key: the code view's keys win there, the git view's in git. "
      + "Two commands on one key in the same place clash, and only one runs.",
    .editor: "Fold All and Unfold All are two-key chords after ⌘K.",
  ]
}
