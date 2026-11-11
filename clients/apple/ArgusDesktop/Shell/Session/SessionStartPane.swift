import ArgusUI
import SwiftUI

/// A session with no agent yet: "What should we work on?" over the start
/// composer, laid out as a new agent's first screen; sending starts the agent.
struct SessionStartPane: View {
  @Environment(\.theme) private var theme
  @Environment(DesktopModel.self) private var model
  let sessionId: String
  /// Images and files dropped on the pane go to the composer.
  @State private var drops = ComposerDropInbox()
  @State private var dropTargeted = false
  @State private var workspace = StartWorkspace()

  var body: some View {
    VStack(spacing: 0) {
      Color.clear
        .frame(maxHeight: .infinity)
        .overlay(alignment: .bottom) {
          AgentStartTitle(sessionId: sessionId).padding(.bottom, 18)
        }
      ChatInputView(startingIn: sessionId, starter: model.composerStarter(session: sessionId)) { affordance in
        MacTelemetry.capture(.inputUsed(affordance: affordance.rawValue))
      }
      .startWorkspace(workspace, session: model.session(sessionId))
      // Shares the height with the space above, which centres the composer.
      Color.clear.frame(maxHeight: .infinity)
        .overlay(alignment: .top) {
          if let session = model.session(sessionId), session.setupPending == true {
            SetupPendingRow(session: session).frame(maxWidth: 520).padding(.top, 18)
          }
        }
    }
    .contentShape(.rect)
    .onDrop(of: ComposerDropInbox.types, isTargeted: $dropTargeted, perform: drops.accept)
    .overlay {
      if dropTargeted {
        Rectangle().strokeBorder(theme.accent, lineWidth: 2).allowsHitTesting(false)
      }
    }
    .environment(\.composerDropInbox, drops)
    .receivesPickedElements(sessionId: sessionId, into: drops)
    .environment(\.composerFocusRequest, model.composerFocusRequest)
  }
}
