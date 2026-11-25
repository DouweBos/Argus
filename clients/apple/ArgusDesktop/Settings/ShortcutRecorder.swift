import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// A command's key, as a control: click, then press the new key. ⎋ cancels, ⌫ leaves it without one.
struct ShortcutRecorder: View {
  @Environment(\.theme) private var theme
  let chord: KeyChord?
  /// A fixed two-key chord, or a key macOS owns: shown, never recorded.
  var fixed: [KeyChord]? = nil
  let isRecording: Bool
  let conflict: Bool
  let onToggle: () -> Void

  var body: some View {
    if let fixed {
      keys(fixed.flatMap(\.displayParts), muted: true)
        .padding(.horizontal, 8)
        .frame(minWidth: 96, minHeight: 24)
        .help("Can't be changed")
    } else {
      Button(action: onToggle) {
        Group {
          if isRecording {
            Text("Type a shortcut").font(.scaled(size: 12)).foregroundStyle(theme.accent)
          } else if let chord {
            keys(chord.displayParts, muted: false)
          } else {
            Text("None").font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
          }
        }
        .padding(.horizontal, 8)
        .frame(minWidth: 96, minHeight: 24)
        .background(isRecording ? theme.accentSoft : theme.bgTertiary, in: .rect(cornerRadius: 6))
        .overlay(
          RoundedRectangle(cornerRadius: 6)
            .strokeBorder(isRecording ? theme.accentBorder : conflict ? theme.error : theme.border))
        .contentShape(.rect(cornerRadius: 6))
      }
      .buttonStyle(.argusPlain)
      .help(isRecording ? "Press the new shortcut; Escape cancels, Delete removes it" : "Click to change")
      .accessibilityLabel(chord.map { "Shortcut \($0.display)" } ?? "No shortcut")
    }
  }

  private func keys(_ parts: [String], muted: Bool) -> some View {
    KeyHint(parts: parts, size: 12, boxed: false)
      .foregroundStyle(muted ? theme.textMuted : theme.text)
  }
}

/// Takes the next key while a recorder listens, ahead of the menus and the shortcut router.
@MainActor
final class ShortcutKeyListener {
  enum Outcome {
    case chord(KeyChord)
    case clear
    case cancel
  }

  private var monitor: Any?

  func start(_ handle: @escaping @MainActor (Outcome) -> Void) {
    stop()
    monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      nonisolated(unsafe) let event = event
      let consumed = MainActor.assumeIsolated {
        guard let chord = KeyChord(event: event) else { return false }
        if chord.modifiers.isEmpty, chord.key == KeyChord.Key.escape {
          handle(.cancel)
        } else if chord.modifiers.isEmpty, chord.key == KeyChord.Key.delete || chord.key == KeyChord.Key.forwardDelete {
          handle(.clear)
        } else if chord.isUsable {
          handle(.chord(chord))
        } else {
          // A plain key would type; it needs ⌘, ⌃ or ⌥, unless it's an F-key.
          NSSound.beep()
        }
        return true
      }
      return consumed ? nil : event
    }
  }

  func stop() {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
  }
}
