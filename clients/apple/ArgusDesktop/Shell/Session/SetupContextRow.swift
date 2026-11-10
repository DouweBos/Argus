import ArgusCore
import ArgusUI
import SwiftUI

/// The context card's nudge for a worktree made outside Argus: its project's
/// setup never ran. Opens the same Run setup / Skip choice the start pane shows,
/// so it stays reachable once an agent is open.
struct SetupContextRow: View {
  let session: RemoteSession
  @State private var open = false

  var body: some View {
    Button {
      open = true
      MacTelemetry.capture(.contextCardUsed(action: .setup))
    } label: {
      ContextCardRow(icon: Icon.setup, title: "Setup never ran") {
        StatusDot(tone: .warning)
      }
    }
    .buttonStyle(ContextRowButtonStyle(selected: open))
    .help("Run the project's setup in this worktree")
    .popover(isPresented: $open, arrowEdge: .leading) {
      SetupPendingRow(session: session)
        .padding(12)
        .frame(width: 320, alignment: .leading)
    }
  }
}
