import ArgusCore
import ArgusUI
import SwiftUI

/// A terminal tab's glyph: a spinner while a run is going, a play glyph for a
/// stopped run (red when it failed), else a terminal glyph.
struct TerminalTabIcon: View {
  @Environment(\.theme) private var theme
  let tab: TerminalsStore.Tab

  var body: some View {
    if tab.isRun && !tab.exited {
      ProgressView().controlSize(.mini)
    } else {
      Image(systemName: tab.isRun ? "play.fill" : Icon.terminal)
        .font(.scaled(size: 10))
        .foregroundStyle(tab.exitCode.map { $0 == 0 ? theme.textMuted : theme.error } ?? theme.textMuted)
    }
  }
}

extension TerminalsStore.Tab {
  /// A running run is stopped from the run control, not closed away.
  var closable: Bool { !(isRun && !exited) }
}
