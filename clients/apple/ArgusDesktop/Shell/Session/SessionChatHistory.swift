import ArgusCore
import ArgusUI
import SwiftUI

/// A session's past chats, imported ones included, as the host lists them by branch.
@MainActor
enum SessionChats {
  static func load(_ session: RemoteSession, store: HostStore) async -> [ArgusProtocol.ChatHistoryEntry]? {
    guard let backend = store.backend else { return nil }
    let entries = try? await backend.request(
      ArgusProtocol.Commands.ListChatHistory.self, .init(repoRoot: session.repoRoot))
    // History is written while an agent runs; a live one is its tab, not a past chat, as on the desktop.
    let live = Set((store.agentsByRepo[session.repoRoot] ?? []).map(\.agentId))
    return entries?
      .filter { $0.sessionBranch == session.branch && !($0.agentId.map(live.contains) ?? false) }
      .sorted { $0.endedAt > $1.endedAt }
  }

  /// Reloads as agents come and go, since a stopped agent's chat lands here.
  static func reloadKey(_ session: RemoteSession, store: HostStore) -> String {
    "\(session.repoRoot)|\(session.branch)|\(store.agentsByRepo[session.repoRoot]?.count ?? 0)"
  }
}

/// The context card's Recent Chats: search the session's chats, open one to
/// read it, resume it in a new agent, or delete it.
struct RecentChatsSheet: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let session: RemoteSession
  /// Called after a delete, so the card's count follows.
  let changed: () -> Void

  @State private var entries: [ArgusProtocol.ChatHistoryEntry] = []
  @State private var loaded = false
  @State private var query = ""
  @State private var searched = false
  @State private var viewing: ViewedChat?
  @State private var confirmingClear = false

  private var shown: [ArgusProtocol.ChatHistoryEntry] {
    let needle = query.trimmingCharacters(in: .whitespaces)
    guard !needle.isEmpty else { return entries }
    return entries.filter { $0.title.localizedCaseInsensitiveContains(needle) }
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider()
      list
    }
    .frame(width: 520, height: 460)
    .task(id: SessionChats.reloadKey(session, store: store)) { await load() }
    .onChange(of: query) { _, value in
      guard !searched, !value.isEmpty else { return }
      searched = true
      MacTelemetry.capture(.chatHistoryUsed(action: .search))
    }
    .sheet(item: $viewing) { chat in
      ChatHistoryViewer(chat: chat, sessionId: session.id) {
        viewing = nil
        Task { await resume(chat.entry) }
      }
    }
    .confirmationDialog("Delete every saved chat in this session?", isPresented: $confirmingClear) {
      Button("Delete All", role: .destructive) { Task { await delete(entries) } }
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("Recent Chats").font(.scaled(.headline))
        Spacer()
        Button("Clear All…") { confirmingClear = true }
          .buttonStyle(.argusBorderless)
          .disabled(entries.isEmpty)
        Button("Done") { dismiss() }
          .keyboardShortcut(.cancelAction)
      }
      TextField("Search chats", text: $query)
        .textFieldStyle(.roundedBorder)
    }
    .padding(16)
  }

  @ViewBuilder private var list: some View {
    if !loaded {
      ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if shown.isEmpty {
      QuietEmptyState(
        icon: Icon.history, title: entries.isEmpty ? "No chats yet" : "No matches",
        message: entries.isEmpty
          ? "Chats this session's agents have finished show up here."
          : "No chat title matches \u{201C}\(query)\u{201D}.")
    } else {
      ScrollView {
        LazyVStack(spacing: 0) {
          ForEach(shown, id: \.id) { entry in
            ChatHistoryRow(entry: entry) {
              view(entry)
            } resume: {
              Task { await resume(entry) }
            } delete: {
              Task { await delete([entry]) }
            }
            .padding(.horizontal, 16)
          }
        }
        .padding(.vertical, 6)
      }
    }
  }

  private func load() async {
    entries = await SessionChats.load(session, store: store) ?? entries
    loaded = true
  }

  /// Paged from the host like a stopped agent's transcript, so a long chat
  /// opens at its newest page instead of decoding the whole file.
  private func view(_ entry: ArgusProtocol.ChatHistoryEntry) {
    viewing = ViewedChat(entry: entry, key: HostStore.stoppedKey(repoRoot: session.repoRoot, historyId: entry.id))
    MacTelemetry.capture(.chatHistoryUsed(action: .view))
  }

  /// A new agent on the chat's Claude session and runner; the host seeds its transcript.
  private func resume(_ entry: ArgusProtocol.ChatHistoryEntry) async {
    guard
      let agent = await store.spawnAgent(
        sessionId: session.id, resumeSessionId: entry.sessionId, runnerId: entry.runnerId)
    else { return }
    dismiss()
    // Open it straight away, as the desktop does; the transcript fills in.
    model.open(spawned: agent.agentId, session: session.id)
    MacTelemetry.capture(.chatHistoryUsed(action: .resume))
  }

  private func delete(_ doomed: [ArgusProtocol.ChatHistoryEntry]) async {
    guard let backend = store.backend else { return }
    for entry in doomed {
      _ = try? await backend.request(
        ArgusProtocol.Commands.DeleteChatHistory.self, .init(repoRoot: session.repoRoot, historyId: entry.id))
    }
    await load()
    changed()
    MacTelemetry.capture(.chatHistoryUsed(action: doomed.count > 1 ? .clear : .delete))
  }
}

/// A saved chat on screen, by its stopped-transcript key.
struct ViewedChat: Identifiable {
  let entry: ArgusProtocol.ChatHistoryEntry
  let key: String
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
          HStack(spacing: 6) {
            Text(meta).font(.scaled(.caption)).foregroundStyle(theme.textSecondary).lineLimit(1)
            if entry.importedFrom == .claudeCode {
              Badge(label: "Imported").help("Imported · Claude Code")
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
      }
      .buttonStyle(.argusPlain)
      Button("Resume", action: resume)
        .controlSize(.small)
        .help("Continue this chat in a new agent")
      Button(action: delete) {
        Image(systemName: "xmark")
      }
      .buttonStyle(.argusBorderless)
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
    TranscriptView(agentKey: chat.key, sessionId: sessionId)
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
