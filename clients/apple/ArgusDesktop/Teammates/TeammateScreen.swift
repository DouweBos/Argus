import ArgusCore
import ArgusUI
import SwiftUI

/// `/teammates/:teammateId[/…]`: one teammate. Its conversation by default;
/// the profile, duties and memory are pages of their own route.
struct TeammateScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(TeammatesStore.self) private var store
  let teammateId: String
  let page: TeammatePage

  private enum Tab: String, CaseIterable {
    case chat = "Conversation", profile = "Profile", duties = "Duties", memory = "Memory"
  }

  private var tab: Tab {
    switch page {
    case .chat: .chat
    case .profile: .profile
    case .duties: .duties
    case .memory: .memory
    }
  }

  var body: some View {
    let teammate = store.teammate(teammateId)
    Group {
      if let teammate {
        switch page {
        case .chat(let threadId): TeammateConversation(teammate: teammate, threadId: threadId)
        case .profile: TeammateProfileForm(teammateId: teammateId)
        case .duties: TeammateDutiesView(teammateId: teammateId)
        case .memory: TeammateMemoryView(teammateId: teammateId)
        }
      } else if store.loaded {
        EmptyState(
          icon: Icon.teammates, title: "Teammate not found", body: "It may have been deleted on this host."
        ) {
          Button("Back to Teammates") { model.navigate(.teammates) }
        }
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle(teammate?.name ?? "Teammate")
    .navigationSubtitle(teammate.map { "@\($0.handle)\($0.enabled ? "" : " · paused")" } ?? "")
    .toolbar {
      ToolbarItem(placement: .principal) {
        Picker("Page", selection: Binding(get: { tab }, set: show)) {
          ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
      }
    }
    .task {
      if !store.loaded { await store.refresh() }
      await store.loadDetail(id: teammateId)
    }
  }

  private func show(_ tab: Tab) {
    let page: TeammatePage =
      switch tab {
      case .chat: .chat(threadId: nil)
      case .profile: .profile
      case .duties: .duties
      case .memory: .memory
      }
    model.navigate(.teammate(id: teammateId, page: page))
  }
}

/// The threads down the side and the open one's transcript and input.
private struct TeammateConversation: View {
  @Environment(DesktopModel.self) private var model
  @Environment(TeammatesStore.self) private var store
  @Environment(HostStore.self) private var host
  let teammate: TeammatesStore.Teammate
  let threadId: String?

  @State private var opened: ArgusProtocol.OpenedTeammateThread?
  @State private var failed = false

  var body: some View {
    HStack(spacing: 0) {
      threads.frame(width: 230)
      Divider()
      Group {
        if let opened {
          TeammateChat(agentId: opened.agentId, sessionId: opened.sessionId).id(opened.agentId)
        } else if failed {
          EmptyState(
            icon: "exclamationmark.bubble", title: "Couldn't open the conversation",
            body: store.error ?? "The host didn't answer."
          ) {
            Button("Try Again") { Task { await open() } }
          }
        } else {
          ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .task(id: threadId) { await open() }
  }

  private var threads: some View {
    let list = store.threadsById[teammate.id] ?? []
    return VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Conversations").font(.scaled(.caption)).foregroundStyle(.secondary)
        Spacer()
        Button { Task { await openFresh() } } label: { Image(systemName: "square.and.pencil") }
          .buttonStyle(.argusBorderless)
          .help("New Conversation")
      }
      .padding(.horizontal, 12).padding(.vertical, 8)
      ScrollView {
        VStack(alignment: .leading, spacing: 1) {
          ForEach(list) { thread in
            SettingsNavItem(
              thread.title.isEmpty ? "New conversation" : thread.title,
              systemImage: Self.icon(for: thread.surface),
              selected: thread.id == opened?.thread.id
            ) {
              model.navigate(.teammate(id: teammate.id, page: .chat(threadId: thread.id)))
            }
            .contextMenu {
              Button("Archive") {
                Task { await store.archiveThread(teammateId: teammate.id, threadId: thread.id) }
              }
            }
          }
        }
        .padding(.horizontal, 8)
      }
    }
  }

  /// Where a thread started: the app, Slack, a Linear comment, or another teammate.
  static func icon(for surface: ArgusProtocol.TeammateThreadSurface) -> String {
    switch surface.rawValue {
    case "slack": "number"
    case "linear": "text.bubble"
    case "handoff": Icon.teammates
    default: "bubble.left"
    }
  }

  private func open() async {
    failed = false
    opened = await store.openThread(teammateId: teammate.id, threadId: threadId)
    failed = opened == nil
  }

  private func openFresh() async {
    guard let fresh = await store.openThread(teammateId: teammate.id, fresh: true) else { return }
    model.navigate(.teammate(id: teammate.id, page: .chat(threadId: fresh.thread.id)))
  }
}

/// A teammate thread's transcript and input: the session chat, without the
/// session's start workspace, since a teammate's folder is not a project.
private struct TeammateChat: View {
  @Environment(HostStore.self) private var store
  let agentId: String
  let sessionId: String

  var body: some View {
    VStack(spacing: 0) {
      TranscriptView(agentKey: agentId, sessionId: sessionId)
      ChatInputView(agentId: agentId, sessionId: sessionId) { affordance in
        MacTelemetry.capture(.inputUsed(affordance: affordance.rawValue))
      }
    }
    .task {
      await store.watchAgent(agentId, on: true)
      await store.loadTranscript(agentId: agentId)
      await store.loadCapabilities(agentId: agentId)
      if store.statusByAgent[agentId] == nil { await store.loadAgentStatus(agentId: agentId) }
    }
    .onDisappear {
      Task { await store.watchAgent(agentId, on: false) }
    }
  }
}
