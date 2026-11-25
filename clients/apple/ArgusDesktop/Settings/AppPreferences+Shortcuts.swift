import ArgusCore
import ArgusEditor

extension AppPreferences {
  /// Settings → Keyboard's changes: `chord` nil leaves the command without a key.
  func rebind(_ command: ShortcutCommand, to chord: KeyChord?) {
    shortcutKeymap.bind(command.id, to: chord)
    let conflict = !shortcutKeymap.conflicts(for: command.id).isEmpty
    MacTelemetry.capture(.shortcutChanged(action: chord == nil ? .clear : .rebind, command: command.id, conflict: conflict))
  }

  func resetShortcut(_ command: ShortcutCommand) {
    shortcutKeymap.reset(command.id)
    MacTelemetry.capture(.shortcutChanged(action: .reset, command: command.id, conflict: false))
  }

  func resetAllShortcuts() {
    shortcutKeymap.resetAll()
    MacTelemetry.capture(.shortcutChanged(action: .resetAll, command: nil, conflict: false))
  }

  /// Hands the editor the keys it matches itself, ahead of the menus.
  func applyEditorKeymap() {
    var overrides: [EditorCommand: EditorShortcut?] = [:]
    for command in EditorCommand.allCases where shortcutKeymap.isCustomized(ShortcutCommand.editor(command).id) {
      overrides[command] = .some(shortcutKeymap.chord(for: ShortcutCommand.editor(command))?.editorShortcut)
    }
    EditorKeymap.overrides = overrides
    EditorKeymap.sendSelection = shortcutKeymap.chord(for: ShortcutCommand.sendSelection)?.editorShortcut
  }
}
