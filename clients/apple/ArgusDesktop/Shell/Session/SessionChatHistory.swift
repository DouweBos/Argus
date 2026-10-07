import ArgusCore
import ArgusUI
import SwiftUI

/// The session's past chats, as the desktop's session home lists them: open
/// one to read it, resume it in a new agent, or delete it.
struct SessionChatHistoryCard: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let session: RemoteSession

  @State private var entries: [ArgusProtocol.ChatHistoryEntry] = []
  @State private var viewing: ViewedChat?
  @State private var confirmingClear = false

  /// The desktop matches a session's chats by branch.
  private var sessionEntries: [ArgusProtocol.ChatHistoryEntry] {
    entries.filter { $0.sessionBranch == session.branch }.sorted { $0.endedAt > $1.endedAt }
  }

  var body: some View {
    // A stack, not a Group: an empty Group has nothing to hang `.task` on.
    VStack(spacing: 0) {
      if !sessionEntries.isEmpty {
        Card {
          HStack {
            SectionHeader(title: "Chat history", count: sessionEntries.count)
            Spacer()
            Button("Clear All…") { confirmingClear = true }
              .buttonStyle(.borderless)
              .controlSize(.small)
          }
          ForEach(sessionEntries, id: \.id) { entry in
            ChatHistoryRow(entry: entry) {
              Task { await view(entry) }
            } resume: {
              Task { await resume(entry) }
            } delete: {
              Task { await delete([entry]) }
            }
          }
        }
      }
    }
    .task(id: "\(session.repoRoot)|\(store.agentsByRepo[session.repoRoot]?.count ?? 0)") { await load() }
    .sheet(item: $viewing) { chat in
      ChatHistoryViewer(chat: chat, sessionId: session.id) {
        viewing = nil
        Task { await resume(chat.entry) }
      }
    }
    .confirmationDialog(
      "Delete every saved chat in this session?", isPresented: $confirmingClear
    ) {
      Button("Delete All", role: .destructive) { Task { await delete(sessionEntries) } }
    }
  }

  private func load() async {
    guard let backend = store.backend else { return }
    entries =
      (try? await backend.request(
        ArgusProtocol.Commands.ListChatHistory.self, .init(repoRoot: session.repoRoot))) ?? []
  }

  private func saved(_ entry: ArgusProtocol.ChatHistoryEntry) async -> ArgusProtocol.SavedConversation? {
    guard let backend = store.backend else { return nil }
    return (try? await backend.request(
      ArgusProtocol.Commands.LoadChatHistory.self, .init(repoRoot: session.repoRoot, historyId: entry.id))) ?? nil
  }

  private func view(_ entry: ArgusProtocol.ChatHistoryEntry) async {
    guard let saved = await saved(entry) else { return }
    let conversation = AgentConversation(messages: LiveAgents.messages(of: saved))
    // A saved chat's agent is gone: calls without a result show as interrupted.
    let messages = (try? RemoteTranscriptBuilder.messages(conversation, settled: true)) ?? []
    viewing = ViewedChat(entry: entry, messages: messages)
    MacTelemetry.capture(.chatHistoryUsed(action: .view))
  }

  /// A new agent on the chat's Claude session and runner, seeded with its transcript.
  private func resume(_ entry: ArgusProtocol.ChatHistoryEntry) async {
    let saved = await saved(entry)
    guard
      let agent = await store.spawnAgent(
        sessionId: session.id, resumeSessionId: entry.sessionId, runnerId: entry.runnerId)
    else { return }
    // Open it straight away, as the desktop does; the transcript fills in.
    model.open(spawned: agent.agentId, session: session.id)
    MacTelemetry.capture(.chatHistoryUsed(action: .resume))
    if let saved { await store.live?.restore(agent.agentId, from: saved) }
  }

  private func delete(_ doomed: [ArgusProtocol.ChatHistoryEntry]) async {
    guard let backend = store.backend else { return }
    for entry in doomed {
      _ = try? await backend.request(
        ArgusProtocol.Commands.DeleteChatHistory.self, .init(repoRoot: session.repoRoot, historyId: entry.id))
    }
    await load()
    MacTelemetry.capture(.chatHistoryUsed(action: doomed.count > 1 ? .clear : .delete))
  }
}

/// A saved chat on screen.
struct ViewedChat: Identifiable {
  let entry: ArgusProtocol.ChatHistoryEntry
  let messages: [RemoteMessage]
  var id: String { entry.id }
}

private struct ChatHistoryRow: View {
  @Environment(\.theme) private var theme
  let entry: ArgusProtocol.ChatHistoryEntry
  let open: () -> Void
  let resume: () -> Void
  let delete: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Button(action: open) {
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.title).lineLimit(1)
          Text(meta).font(.scaled(.caption)).foregroundStyle(theme.textSecondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      Button("Resume", action: resume)
        .controlSize(.small)
        .help("Continue this chat in a new agent")
      Button(action: delete) {
        Image(systemName: "xmark")
      }
      .buttonStyle(.borderless)
      .help("Delete")
      .accessibilityLabel("Delete chat")
    }
    .padding(.vertical, 4)
  }

  private var meta: String {
    let ended = Date(timeIntervalSince1970: entry.endedAt / 1000)
    let count = Int(entry.messageCount)
    return [
      ended.formatted(.relative(presentation: .named)), entry.sessionBranch,
      "\(count) msg\(count == 1 ? "" : "s")",
    ].joined(separator: " · ")
  }
}

/// A saved chat, read only, with a way to pick it back up.
private struct ChatHistoryViewer: View {
  @Environment(\.dismiss) private var dismiss
  let chat: ViewedChat
  let sessionId: String
  let resume: () -> Void

  var body: some View {
    TranscriptView(agentKey: "history:\(chat.entry.id)", sessionId: sessionId, fixture: chat.messages)
      .frame(minWidth: 640, idealWidth: 760, minHeight: 480, idealHeight: 640)
      .safeAreaInset(edge: .top) {
        Text(chat.entry.title)
          .font(.scaled(.headline))
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding([.top, .horizontal], 20)
      }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Resume", action: resume)
        }
      }
  }
}

/// The desktop's Rename Branch dialog: the host renames the branch and keeps
/// the session on it.
struct RenameBranchSheet: View {
  @Environment(HostStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let session: RemoteSession

  @State private var name = ""
  @State private var saving = false
  @State private var error: String?

  var body: some View {
    Form {
      Section {
        TextField("Branch name", text: $name)
          .onSubmit(rename)
      } footer: {
        Text(error ?? "Spaces become hyphens.")
          .foregroundStyle(error == nil ? theme.textSecondary : theme.error)
      }
    }
    .formStyle(.grouped)
    .safeAreaInset(edge: .top) {
      Text("Rename Branch")
        .font(.scaled(.headline))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding([.top, .horizontal], 20)
    }
    .frame(width: 420)
    .onAppear { name = session.branch }
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { dismiss() }
      }
      ToolbarItem(placement: .confirmationAction) {
        Button(saving ? "Renaming…" : "Rename", action: rename)
          .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
      }
    }
  }

  private func rename() {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      error = "Branch name cannot be empty"
      return
    }
    guard let backend = store.backend else { return }
    saving = true
    error = nil
    Task {
      defer { saving = false }
      do {
        _ = try await backend.request(
          ArgusProtocol.Commands.RenameSessionBranch.self, .init(id: session.id, branch: trimmed))
        await store.loadSessions(repoRoot: session.repoRoot)
        MacTelemetry.capture(.branchRenamed(success: true))
        dismiss()
      } catch {
        self.error = HostStore.describe(error)
        MacTelemetry.capture(.branchRenamed(success: false))
      }
    }
  }
}
