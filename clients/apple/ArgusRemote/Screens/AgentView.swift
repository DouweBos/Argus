import ArgusUI
import SwiftUI

/// One agent's transcript and the input that drives it — the body of a session
/// screen's tab. The screen around it owns the title and toolbar.
struct AgentView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  let agentId: String
  let label: String

  @State private var viewingToken: Int?
  @State private var messageSheet: MessageSheet?
  @State private var resuming = false

  /// The edit or fork sheet a message's menu opened.
  struct MessageSheet: Identifiable {
    let message: RemoteMessage
    let fork: Bool
    var id: String { "\(fork ? "fork" : "edit"):\(message.id)" }
  }

  private var sessionId: String? { host.statusByAgent[agentId]?.sessionId }

  /// Nothing to hand over until the session behind the agent is known — the
  /// desktop addresses screens by session, not by agent.
  private var handoff: Handoff? {
    guard let sessionId, let identity = app.identity else { return nil }
    let status = host.statusByAgent[agentId]

    return Handoff(
      hostKey: ArgusBase64.encodeURL(identity.desktopStaticKey ?? Data()),
      sessionId: sessionId,
      agentId: agentId,
      label: label,
      projectName: status?.projectName,
      repoRoot: nil)
  }
  private var isGone: Bool { host.isGone(agentId) }

  var body: some View {
    VStack(spacing: 0) {
      AgentTranscriptView(agentKey: agentId, isLive: !isGone) { working in
        Telemetry.capture(.transcriptWorkLogOpened(working: working))
      }
      .environment(\.messageMenu, messageMenu)
      if isGone {
        stoppedFooter
      } else if host.hasControl {
        ChatInputView(agentId: agentId, sessionId: sessionId) { affordance in
          Telemetry.capture(.composerInput(affordance))
        }
      }
    }
    .background(theme.bg.ignoresSafeArea())
    .environment(\.openContinuedAgent) { open($0, label: Labels.agentName($0)) }
    .task { await host.loadRunners() }
    // Handoff: the Mac this agent runs on offers to take it back over.
    .userActivity(Handoff.activityType, isActive: handoff != nil) { activity in
      guard let handoff else { return }
      activity.title = label
      activity.isEligibleForHandoff = true
      activity.addUserInfoEntries(from: handoff.userInfo)
    }
    .environment(\.openFileLink, fileLinkAction)
    // Always asked, not only when the session is unknown: a cached status
    // can belong to an agent that has since been shut down.
    .task { await host.loadAgentStatus(agentId: agentId) }
    // The computer keeps a warm agent in the session on screen, so the next start there is instant.
    .task(id: sessionId) {
      guard host.hasControl, let sessionId else { return }
      viewingToken = await host.reportViewing(sessionId: sessionId)
    }
    .onDisappear {
      guard let viewingToken else { return }
      Task { await host.stopViewing(token: viewingToken) }
    }
    .sheet(item: $messageSheet) { sheet in
      messageSheetView(sheet)
    }
  }

  /// A control device picks the conversation back up in a fresh agent, as a saved chat does.
  @ViewBuilder
  private var stoppedFooter: some View {
    if host.hasControl, host.canResume(agentId: agentId) {
      TranscriptFooterNote {
        MutedText("This agent has stopped.")
        Btn(label: resuming ? "Resuming…" : "Resume in a new agent", icon: Icon.plus, action: resume)
          .disabled(resuming)
      }
    } else {
      TranscriptFooterNote("This agent has stopped, so it can't take new messages.")
    }
  }

  private func resume() {
    resuming = true
    Task {
      let agent = await host.resumeAgent(agentId)
      resuming = false
      guard let agent else { return }
      open(agent, label: label)
    }
  }

  /// A new agent in this session opens as its tab here, as on the Mac; one elsewhere is pushed.
  private func open(_ agent: RemoteAgentStatus, label: String) {
    if let sessionId, agent.sessionId == sessionId {
      router.focusedAgents[session: sessionId] = agent.agentId
    } else {
      router.push(.agent(id: agent.agentId, label: label))
    }
  }

  /// Copy for any message; edit and fork only while the agent runs, this phone
  /// has control and the agent's runner can rewind its chat.
  private var messageMenu: MessageMenu {
    MessageMenu(canChange: host.hasControl && !isGone && host.supportsTranscriptFork(agentId: agentId)) { action, message in
      switch action {
      case .copy:
        guard let text = message.copyText else { return }
        Clipboard.copy(text)
        Telemetry.capture(.messageAction(action: .copy, role: Self.role(message), success: true))
      case .edit: messageSheet = MessageSheet(message: message, fork: false)
      case .fork: messageSheet = MessageSheet(message: message, fork: true)
      }
    }
  }

  @ViewBuilder
  private func messageSheetView(_ sheet: MessageSheet) -> some View {
    let role = Self.role(sheet.message)
    if sheet.fork {
      MessageForkSheet(agentKey: agentId, message: sheet.message) { forked, target in
        Telemetry.capture(
          .messageAction(
            action: target == .session ? .forkSession : .forkAgent, role: role, success: forked != nil))
        guard let forked else { return }
        open(forked.agent, label: Labels.agentName(forked.agent))
      }
    } else {
      MessageEditSheet(agentKey: agentId, message: sheet.message) { success in
        Telemetry.capture(.messageAction(action: .edit, role: role, success: success))
      }
    }
  }

  private static func role(_ message: RemoteMessage) -> TelemetryEvent.MessageRole {
    message.role == .user ? .user : .assistant
  }

  /// File paths in the transcript open the viewer; reading needs control.
  private var fileLinkAction: OpenFileLinkAction? {
    guard let sessionId, host.hasControl else { return nil }
    return OpenFileLinkAction { [router] ref in
      router.push(.file(sessionId: sessionId, path: ref.path, line: ref.line, source: .chatLink))
    }
  }
}

extension HostStore {
  /// Shut down, or stopped on its own: it can't take new messages.
  func isGone(_ agentId: String) -> Bool {
    goneAgents.contains(agentId) || statusByAgent[agentId]?.status == .stopped
  }
}

extension TelemetryEvent {
  /// A composer's input affordance, a chat's or a start's.
  static func composerInput(_ affordance: ChatInputAffordance) -> TelemetryEvent {
    affordance == .followUp ? .followUpUsed : .inputUsed(affordance: affordance.rawValue)
  }
}
