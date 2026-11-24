import ArgusUI
import SwiftUI

/// Talking to a teammate: one conversation's transcript over the composer.
/// Its other conversations, profile, duties and memory are in the toolbar.
///
/// Opening a conversation wakes its agent, which needs control. A monitor
/// device gets the conversation list instead, and a read-only transcript.
struct TeammateView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(TeammatesStore.self) private var store

  let teammateId: String
  /// Nil is the newest conversation.
  let threadId: String?

  @State private var opened: ArgusProtocol.OpenedTeammateThread?
  @State private var opening = false
  @State private var openFailed = false

  private var teammate: TeammatesStore.Teammate? { store.teammate(teammateId) }
  private var threads: [TeammatesStore.Thread] {
    (store.threadsById[teammateId] ?? []).filter { !$0.archived }.sorted { $0.lastOpenedAt > $1.lastOpenedAt }
  }
  private var currentThreadId: String? { opened?.thread.id ?? threadId }

  var body: some View {
    content
      .background(theme.bg.ignoresSafeArea())
      .navigationTitle(teammate?.name ?? "Teammate")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) { conversationsMenu }
        ToolbarItem(placement: .topBarTrailing) { pagesMenu }
      }
      .task {
        if teammate == nil { await store.loadDetail(id: teammateId) }
        await store.loadThreads(teammateId: teammateId)
      }
      .task(id: host.hasControl) { if host.hasControl { await open() } }
  }

  @ViewBuilder
  private var content: some View {
    if host.hasControl {
      if let opened {
        transcript(agentId: opened.agentId, sessionId: opened.sessionId)
      } else if openFailed {
        EmptyState(
          icon: Icon.warning, title: "Couldn't open the conversation",
          body: store.error ?? "The computer didn't answer."
        ) {
          Btn(label: "Retry", tone: .secondary, small: true, icon: Icon.refresh) { Task { await open() } }
            .fixedSize()
        }
      } else {
        Loading(label: "Waking \(teammate?.name ?? "the teammate")")
      }
    } else if let thread = threads.first(where: { $0.id == threadId }) {
      transcript(agentId: thread.agentId, sessionId: nil)
    } else {
      threadList
    }
  }

  @ViewBuilder
  private func transcript(agentId: String, sessionId: String?) -> some View {
    VStack(spacing: 0) {
      AgentTranscriptView(agentKey: agentId, isLive: !host.isGone(agentId)) { working in
        Telemetry.capture(.transcriptWorkLogOpened(working: working))
      }
      .artifactSheet { Telemetry.capture(.artifactOpened) }
      if !host.hasControl {
        TranscriptFooterNote("This device can read conversations but not talk to teammates.")
      } else if host.isGone(agentId) {
        // A teammate's conversation outlives its agent; opening it again resumes it.
        TranscriptFooterNote {
          MutedText("\(teammate?.name ?? "The teammate") went to sleep.")
          Btn(label: opening ? "Waking" : "Wake it up", icon: Icon.play) { Task { await open() } }
            .disabled(opening)
        }
      } else {
        ChatInputView(agentId: agentId, sessionId: sessionId) { affordance in
          Telemetry.capture(.composerInput(affordance))
        }
      }
    }
    .task(id: agentId) { await host.loadAgentStatus(agentId: agentId) }
  }

  /// A monitor device's view: which conversations there are.
  private var threadList: some View {
    List {
      Section {
        ForEach(threads) { thread in
          NavigationLink(value: Route.teammate(id: teammateId, page: .chat(threadId: thread.id))) {
            ThreadRow(thread: thread)
          }
        }
      } footer: {
        Text("This device can read conversations but not talk to teammates.")
      }
    }
    .emptyState(when: threads.isEmpty) {
      EmptyState(
        icon: Icon.chat, title: "No conversations",
        body: "A device with control can start one.")
    }
  }

  private var conversationsMenu: some View {
    Menu {
      if host.hasControl {
        Button {
          Task { await open(fresh: true) }
        } label: {
          Label("New conversation", systemImage: Icon.compose)
        }
        .disabled(opening || host.connection != .ready)
      }
      Section("Conversations") {
        ForEach(threads) { thread in
          Button {
            show(thread.id)
          } label: {
            if thread.id == currentThreadId {
              Label(ThreadRow.title(thread), systemImage: Icon.check)
            } else {
              Text(ThreadRow.title(thread))
            }
          }
        }
      }
    } label: {
      Label("Conversations", systemImage: Icon.history)
    }
  }

  private var pagesMenu: some View {
    Menu {
      NavigationLink(value: Route.teammate(id: teammateId, page: .profile)) {
        Label("Profile", systemImage: Icon.person)
      }
      NavigationLink(value: Route.teammate(id: teammateId, page: .duties)) {
        Label("Duties", systemImage: Icon.automations)
      }
      NavigationLink(value: Route.teammate(id: teammateId, page: .memory)) {
        Label("Memory", systemImage: "brain")
      }
    } label: {
      Label("More", systemImage: Icon.ellipsis)
    }
  }

  /// Another conversation is another route; swapping keeps back on the list.
  private func show(_ threadId: String) {
    guard threadId != currentThreadId else { return }
    router.replaceTop(with: .teammate(id: teammateId, page: .chat(threadId: threadId)), dropping: 1)
  }

  private func open(fresh: Bool = false) async {
    opening = true
    openFailed = false
    let result = await store.openThread(
      teammateId: teammateId, threadId: fresh ? nil : threadId, fresh: fresh)
    opening = false
    guard let result else {
      openFailed = opened == nil
      return
    }
    if fresh {
      show(result.thread.id)
    } else {
      opened = result
    }
  }
}

/// One conversation in a list: what it was about, and when it was last open.
private struct ThreadRow: View {
  let thread: TeammatesStore.Thread

  static func title(_ thread: TeammatesStore.Thread) -> String {
    let title = thread.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return title.isEmpty ? "New conversation" : title
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(Self.title(thread)).lineLimit(1)
      Text(Labels.timeAgo(thread.lastOpenedAt))
        .font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(1)
    }
  }
}
