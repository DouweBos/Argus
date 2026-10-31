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
          .disabled(
            trimmed.isEmpty || trimmed == message.editableText.trimmingCharacters(in: .whitespacesAndNewlines)
              || working)
      }
    }
    .padding(20)
    .frame(width: 520)
    .onAppear { draft = message.editableText }
  }

  private func submit() {
    working = true
    error = nil
    let edited = trimmed
    Task {
      do {
        try await host.rewind(agentId: agentKey, message: message, edited: edited)
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
  let message: RemoteMessage

  @State private var target = HostStore.MessageForkTarget.session
  @State private var summary = ""
  @State private var branch = ""
  @State private var working = false
  @State private var error: String?

  private var role: MacTelemetryEvent.MessageRole { message.role == .user ? .user : .assistant }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Fork chat").font(.scaled(.headline))
      Picker("Fork into", selection: $target) {
        Text("New session").tag(HostStore.MessageForkTarget.session)
        Text("New agent here").tag(HostStore.MessageForkTarget.agent)
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
    working = true
    error = nil
    let target = target
    let action: MacTelemetryEvent.MessageAction = target == .session ? .forkSession : .forkAgent
    Task {
      do {
        let forked = try await host.fork(
          agentId: agentKey, message: message, into: target,
          description: target == .session ? summary : nil, branch: target == .session ? branch : nil)
        MacTelemetry.capture(.messageAction(action: action, role: role, success: true))
        dismiss()
        desktop.open(spawned: forked.agent.agentId, session: forked.sessionId)
      } catch {
        MacTelemetry.capture(.messageAction(action: action, role: role, success: false))
        self.error = HostStore.describe(error)
        working = false
      }
    }
  }
}
