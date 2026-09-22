import ArgusKit
import SwiftUI

/// The transcript: structured messages with inline tool calls, permission
/// forms, task lists, queued messages and the working indicator.
///
/// Live-refreshes off agent events with a poll as a backstop, and lazily loads
/// older history when you scroll to the top.
struct AgentTranscriptView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let agentKey: String
  /// A stopped agent's transcript is history; there is nothing to subscribe to.
  var isLive = true

  @State private var loadingOlder = false
  @State private var atBottom = true
  /// Opening an agent lands at the newest message; the first content pass
  /// jumps there without animating so it never reads as a scroll.
  @State private var hasLandedAtBottom = false

  private static let bottomAnchor = "transcript-bottom"

  private var messages: [RemoteMessage] { app.visibleMessages(for: agentKey) }
  private var segments: [ToolGroups.Segment] { ToolGroups.group(messages) }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 10) {
          topSentinel

          if messages.isEmpty {
            EmptyState(
              icon: Icon.agent,
              title: "Nothing yet",
              body: isLive
                ? "Send this agent a message to get it going."
                : "This conversation has no saved messages.")
          }

          if let tasks = app.tasksByAgent[agentKey], !tasks.isEmpty {
            TaskListView(
              title: "Tasks",
              items: tasks.map { ($0.activeForm ?? $0.subject, $0.status, $0.owner) })
          }
          if let todos = app.todosByAgent[agentKey], !todos.isEmpty {
            TaskListView(
              title: "Todos",
              items: todos.map { ($0.activeForm ?? $0.content, $0.status, nil) })
          }

          ForEach(segments) { segment in
            switch segment {
            case .single(let message):
              TranscriptMessageView(agentKey: agentKey, message: message)
            case .collapsed(let group):
              CollapsedToolGroupView(agentKey: agentKey, messages: group)
            }
          }

          WorkingIndicator(
            status: app.statusByAgent[agentKey]?.status,
            pendingToolName: app.pendingToolByAgent[agentKey],
            pendingToolInput: nil,
            hasPendingPermission: hasPendingPermission)

          queued

          Color.clear.frame(height: 1).id(Self.bottomAnchor)
        }
        .padding(theme.space)
      }
      .onChange(of: messages.count) { _, count in
        guard count > 0 else { return }
        if !hasLandedAtBottom {
          hasLandedAtBottom = true
          proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
          return
        }
        // Follow the tail only while the reader is already at it. Yanking
        // them out of history they deliberately scrolled back to is worse
        // than a missed message; they rejoin by scrolling back down.
        guard atBottom else { return }
        withAnimation(.easeOut(duration: 0.2)) {
          proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
      }
      .onChange(of: agentKey) { _, _ in
        hasLandedAtBottom = false
        atBottom = true
      }
      .overlay(alignment: .bottomTrailing) {
        if !atBottom {
          Button {
            withAnimation { proxy.scrollTo(Self.bottomAnchor, anchor: .bottom) }
          } label: {
            Image(systemName: Icon.chevronDown)
              .font(.system(size: 13, weight: .bold))
              .foregroundStyle(theme.onAccent)
              .padding(10)
              .background(theme.accent)
              .clipShape(Circle())
          }
          .buttonStyle(.plain)
          .padding(theme.space)
        }
      }
      .defaultScrollAnchor(.bottom, for: .initialOffset)
      // Scrolling the transcript by hand means you want to read it, not type.
      // `.immediately` rather than `.interactively`: the latter only gives way
      // when the drag reaches the keyboard, so an upward flick would keep it.
      .scrollDismissesKeyboard(.immediately)
      .onScrollGeometryChange(for: Bool.self) { geometry in
        geometry.contentOffset.y + geometry.containerSize.height
          >= geometry.contentSize.height - 60
      } action: { _, isAtBottom in
        atBottom = isAtBottom
      }
    }
    .task(id: agentKey) { await start() }
    .liveRefresh(enabled: app.connection == .ready, every: .seconds(5)) {
      await app.loadTranscript(agentId: agentKey)
    }
    .onDisappear {
      guard isLive else { return }
      Task { await app.watchAgent(agentKey, on: false) }
    }
  }

  /// Scrolling this into view means the reader wants older history.
  private var topSentinel: some View {
    Group {
      if app.hasOlderMessages(for: agentKey) {
        HStack {
          Spacer()
          if loadingOlder {
            ProgressView().controlSize(.small)
            MutedText("Loading earlier messages…")
          }
          Spacer()
        }
        .frame(height: 28)
        .onAppear {
          guard !loadingOlder else { return }
          loadingOlder = true
          Task {
            await app.loadOlderMessages(agentId: agentKey)
            loadingOlder = false
          }
        }
      }
    }
  }

  private var hasPendingPermission: Bool {
    messages.contains { message in
      message.toolCalls.contains { app.isToolCallPending(agentKey: agentKey, call: $0) }
    }
  }

  @ViewBuilder
  private var queued: some View {
    let items = app.queuedByAgent[agentKey] ?? []
    if !items.isEmpty {
      SectionHeader(title: "Queued", count: items.count)
      ForEach(items) { message in
        QueuedMessageCard(agentKey: agentKey, message: message)
      }
    }
  }

  private func start() async {
    await app.loadTranscript(agentId: agentKey)
    guard isLive else { return }
    await app.loadQueue(agentId: agentKey)
    await app.watchAgent(agentKey, on: true)
    // Subscriptions are fire-and-forget, so an event emitted before the
    // gateway registered ours is simply lost — the first question being the
    // usual casualty. One catch-up fetch closes that window.
    try? await Task.sleep(for: .milliseconds(600))
    await app.loadTranscript(agentId: agentKey)
  }
}

/// A message still waiting to be sent — editable in place, because a phone is
/// usually where you notice the typo.
struct QueuedMessageCard: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let agentKey: String
  let message: RemoteQueuedMessage

  @State private var editing = false
  @State private var draft = ""
  @State private var confirmingRemove = false

  /// The stored text carries the linked-projects preamble; the editor only
  /// ever shows what the user typed, and the preamble is rebuilt on save.
  private var parsed: LinkedProjects.Parsed? {
    LinkedProjects.parsePreamble(message.text)
  }
  private var displayText: String {
    parsed?.rest ?? message.displayText ?? message.text
  }

  var body: some View {
    Card {
      if editing {
        ThemedTextField(placeholder: "Message", text: $draft, multiline: true)
        HStack(spacing: 8) {
          Btn(label: "Save", small: true) { save() }
          Btn(label: "Cancel", tone: .ghost, small: true) { editing = false }
        }
      } else {
        HStack(alignment: .top, spacing: 8) {
          Badge(label: "Queued")
          BodyText(displayText)
          Spacer(minLength: 4)
          IconBtn(systemName: Icon.pencil, label: "Edit queued message", size: 13) {
            draft = displayText
            editing = true
          }
          IconBtn(systemName: Icon.close, label: "Remove queued message", size: 13) {
            confirmingRemove = true
          }
        }
      }
    }
    .confirmationDialog(
      "Remove this queued message?", isPresented: $confirmingRemove, titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        Task { await app.removeQueued(agentId: agentKey, id: message.id) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(String(displayText.prefix(120)))
    }
  }

  private func save() {
    let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    let paths = parsed?.paths ?? []
    editing = false
    Task {
      // Cleared to nothing with no projects attached is a delete — there
      // would be no message left to send.
      if trimmed.isEmpty && paths.isEmpty {
        await app.removeQueued(agentId: agentKey, id: message.id)
      } else {
        await app.updateQueued(
          agentId: agentKey, id: message.id,
          message: LinkedProjects.buildPreamble(paths: paths, message: trimmed))
      }
    }
  }
}
