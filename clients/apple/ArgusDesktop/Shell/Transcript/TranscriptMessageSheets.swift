import ArgusUI
import SwiftUI

/// Edit one of your messages and rewind the conversation to it, as the
/// desktop's Edit & restore does: everything after it is discarded and the
/// edited message is sent in its place.
struct EditMessageSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  let agentKey: String
  let message: RemoteMessage

  @State private var draft = ""
  @State private var working = false
  @State private var error: String?

  /// The linked-projects preamble goes back on as it came off.
  private var preamble: String? {
    let joined = message.textBlocks.joined(separator: "\n")
    guard let linked = LinkedProjects.parsePreamble(joined) else { return nil }
    return String(joined.dropLast(linked.rest.count))
  }

  private var original: String { TranscriptModel.textBlocks(message).joined(separator: "\n\n") }

  private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Edit message").font(.scaled(.headline))
      TextEditor(text: $draft)
        .font(.scaled(size: 13))
        .frame(minHeight: 120, maxHeight: 320)
        .padding(4)
        .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.border, lineWidth: 1))
      MutedText("Your edit replaces this message and the conversation rewinds to it. Everything after it is discarded.")
      if let error { Text(error).font(.scaled(size: 12)).foregroundStyle(theme.error) }
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Button("Edit & Restore") { submit() }
          .keyboardShortcut(.return, modifiers: .command)
          .disabled(trimmed.isEmpty || trimmed == original.trimmingCharacters(in: .whitespacesAndNewlines) || working)
      }
    }
    .padding(20)
    .frame(width: 520)
    .onAppear { draft = original }
  }

  private func submit() {
    guard let backend = host.backend else { return }
    working = true
    error = nil
    let text = (preamble ?? "") + trimmed
    Task {
      do {
        _ = try await backend.request(
          ArgusProtocol.Commands.RewindAgent.self,
          .init(agentId: agentKey, messageId: message.id, resend: .init(text: text)))
        MacTelemetry.capture(.messageAction(action: .edit, role: .user, success: true))
        dismiss()
      } catch {
        MacTelemetry.capture(.messageAction(action: .edit, role: .user, success: false))
        self.error = HostStore.describe(error)
        working = false
      }
    }
  }
}

/// Fork the chat from a message, into a new session branched at that point
/// or a new agent in this one, as the desktop's Fork chat does.
struct ForkMessageSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(DesktopModel.self) private var desktop
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  let agentKey: String
  let sessionId: String
  let message: RemoteMessage

  private enum Target: String, CaseIterable {
    case session = "New session"
    case agent = "New agent here"
  }

  @State private var target = Target.session
  @State private var summary = ""
  @State private var branch = ""
  @State private var working = false
  @State private var error: String?

  private var role: MacTelemetryEvent.MessageRole { message.role == .user ? .user : .assistant }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Fork chat").font(.scaled(.headline))
      Picker("Fork into", selection: $target) {
        ForEach(Target.allCases, id: \.self) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      if target == .session {
        MutedText("A fresh worktree branched from this point, with the chat up to this message.")
        TextField("What's this fork for?", text: $summary)
        TextField("Branch (generated from the description when empty)", text: $branch)
      } else {
        MutedText("A new agent in this session's worktree, with the chat up to this message.")
      }
      if let error { Text(error).font(.scaled(size: 12)).foregroundStyle(theme.error) }
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Button(target == .session ? "Fork into New Session" : "Fork into New Agent") { submit() }
          .keyboardShortcut(.defaultAction)
          .disabled(working || (target == .session && summary.trimmingCharacters(in: .whitespaces).isEmpty))
      }
    }
    .textFieldStyle(.roundedBorder)
    .padding(20)
    .frame(width: 460)
  }

  private func submit() {
    guard let backend = host.backend else { return }
    working = true
    error = nil
    let target = target
    let summary = summary.trimmingCharacters(in: .whitespaces)
    let branch = branch.trimmingCharacters(in: .whitespaces)
    Task {
      do {
        let point = try await backend.request(
          ArgusProtocol.Commands.AgentForkPoint.self, .init(agentId: agentKey, messageId: message.id))
        let into: String
        let resume: String?
        if target == .session {
          let forked = try await backend.request(
            ArgusProtocol.Commands.ForkSession.self,
            .init(
              sourceSessionId: sessionId, branch: branch, description: summary, forkTimestampMs: point.timestampMs,
              forkTurnNumber: Double(point.turnNumber), sourceClaudeSessionId: point.claudeSessionId,
              replayOps: point.replayOps))
          into = forked.session.id
          resume = forked.claudeSessionId
        } else {
          guard let claude = point.claudeSessionId else { throw ForkError.noSession }
          let forked = try await backend.request(
            ArgusProtocol.Commands.ForkChatInSession.self,
            .init(
              sourceSessionId: sessionId, sourceClaudeSessionId: claude, forkTimestampMs: point.timestampMs,
              forkTurnNumber: Double(point.turnNumber)))
          into = sessionId
          resume = forked.claudeSessionId
        }
        // The host seeds the new agent's transcript with the chat up to the fork.
        let agent = try await backend.request(
          ArgusProtocol.Commands.StartAgent.self,
          .init(
            sessionId: into, resumeSessionId: resume,
            seedFrom: .init(agentId: agentKey, throughMessageId: message.id)))
        MacTelemetry.capture(
          .messageAction(action: target == .session ? .forkSession : .forkAgent, role: role, success: true))
        dismiss()
        desktop.open(spawned: agent.agentId, session: into)
      } catch {
        MacTelemetry.capture(
          .messageAction(action: target == .session ? .forkSession : .forkAgent, role: role, success: false))
        self.error = error is ForkError ? "This conversation has no Claude session to fork from yet." : HostStore.describe(error)
        working = false
      }
    }
  }

  private enum ForkError: Error {
    case noSession
  }
}
