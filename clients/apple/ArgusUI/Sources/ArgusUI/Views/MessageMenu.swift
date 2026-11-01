import ArgusCore
import SwiftUI

/// What a message's long-press menu offers.
public enum MessageMenuAction: Sendable {
  case copy
  case edit
  case fork
}

/// The menu's wiring, from the screen that owns the transcript. Absent, messages have no menu.
public struct MessageMenu {
  /// Edit and fork act on a live conversation the device may control; otherwise only copy.
  public var canChange: Bool
  public var perform: @MainActor (MessageMenuAction, RemoteMessage) -> Void

  public init(canChange: Bool, perform: @escaping @MainActor (MessageMenuAction, RemoteMessage) -> Void) {
    self.canChange = canChange
    self.perform = perform
  }
}

extension EnvironmentValues {
  @Entry public var messageMenu: MessageMenu?
}

extension View {
  /// Copy for any message with text; edit for your own and fork for both while the conversation is live.
  @ViewBuilder
  func messageMenu(_ menu: MessageMenu?, for message: RemoteMessage) -> some View {
    if let menu, !HostStore.isOptimistic(id: message.id), message.copyText != nil || menu.canChange {
      // Also as named actions: a long-press menu alone is out of VoiceOver's reach.
      contextMenu { menuItems(menu, for: message) }
        .accessibilityActions { menuItems(menu, for: message) }
    } else {
      self
    }
  }

  @ViewBuilder
  private func menuItems(_ menu: MessageMenu, for message: RemoteMessage) -> some View {
    if message.copyText != nil {
      Button("Copy", systemImage: Icon.copy) { menu.perform(.copy, message) }
    }
    if menu.canChange {
      if message.role == .user {
        Button("Edit", systemImage: Icon.pencil) { menu.perform(.edit, message) }
      }
      Button("Fork from Here", systemImage: Icon.branch) { menu.perform(.fork, message) }
    }
  }
}

/// Edit one of your messages: the conversation rewinds to it and the edit is
/// sent in its place, everything after it discarded.
public struct MessageEditSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  let agentKey: String
  let message: RemoteMessage
  /// Whether the host took the edit.
  let finished: (Bool) -> Void

  @State private var draft = ""
  @State private var working = false
  @State private var error: String?
  @FocusState private var focused: Bool

  public init(agentKey: String, message: RemoteMessage, finished: @escaping (Bool) -> Void) {
    self.agentKey = agentKey
    self.message = message
    self.finished = finished
  }

  private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var unchanged: Bool { trimmed == message.editableText.trimmingCharacters(in: .whitespacesAndNewlines) }

  public var body: some View {
    NavigationStack {
      Screen {
        Field(
          label: "MESSAGE",
          caption: "Replaces this message. The conversation rewinds to it and everything after it is discarded."
        ) {
          ThemedTextField(placeholder: "Message", text: $draft, multiline: true, lines: 4...16)
            .focused($focused)
        }
        if let error { Text(error).font(.scaled(.footnote)).foregroundStyle(theme.error) }
      }
      .navigationTitle("Edit Message")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(working ? "Restoring…" : "Edit & Restore", action: submit)
            .disabled(trimmed.isEmpty || unchanged || working)
        }
      }
      .onAppear {
        draft = message.editableText
        focused = true
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func submit() {
    working = true
    error = nil
    let edited = trimmed
    Task {
      do {
        try await host.rewind(agentId: agentKey, message: message, edited: edited)
        finished(true)
        dismiss()
      } catch {
        finished(false)
        self.error = HostStore.describe(error)
        working = false
      }
    }
  }
}

/// Fork the chat up to a message into a new agent: in a new session branched
/// at that point, or beside this one.
public struct MessageForkSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  let agentKey: String
  let message: RemoteMessage
  /// Where it went (nil when the host refused), and which way it was forked.
  let finished: (HostStore.ForkedChat?, HostStore.MessageForkTarget) -> Void

  @State private var target = HostStore.MessageForkTarget.session
  @State private var summary = ""
  @State private var branch = ""
  @State private var working = false
  @State private var error: String?

  public init(
    agentKey: String, message: RemoteMessage,
    finished: @escaping (HostStore.ForkedChat?, HostStore.MessageForkTarget) -> Void
  ) {
    self.agentKey = agentKey
    self.message = message
    self.finished = finished
  }

  private var canSubmit: Bool {
    !working && (target == .agent || !summary.trimmingCharacters(in: .whitespaces).isEmpty)
  }

  public var body: some View {
    NavigationStack {
      Screen {
        Picker("Fork into", selection: $target) {
          Text("New session").tag(HostStore.MessageForkTarget.session)
          Text("New agent here").tag(HostStore.MessageForkTarget.agent)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        if target == .session {
          Field(label: "DESCRIPTION", caption: "A fresh worktree branched from this point, with the chat up to this message.") {
            ThemedTextField(placeholder: "What's this fork for?", text: $summary)
          }
          Field(label: "BRANCH", caption: "Generated from the description when empty.") {
            ThemedTextField(placeholder: "Branch", text: $branch, input: .code)
          }
        } else {
          MutedText("A new agent in this session's worktree, with the chat up to this message.")
        }
        if let error { Text(error).font(.scaled(.footnote)).foregroundStyle(theme.error) }
      }
      .navigationTitle("Fork Chat")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(working ? "Forking…" : "Fork", action: submit).disabled(!canSubmit)
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func submit() {
    working = true
    error = nil
    let target = target
    Task {
      do {
        let forked = try await host.fork(
          agentId: agentKey, message: message, into: target,
          description: target == .session ? summary : nil, branch: target == .session ? branch : nil)
        dismiss()
        finished(forked, target)
      } catch {
        finished(nil, target)
        self.error = HostStore.describe(error)
        working = false
      }
    }
  }
}
